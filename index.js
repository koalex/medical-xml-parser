const argv = require('yargs')
    .usage('Usage: node $0 [options]')
    .example('node $0 --src ./bigXML.xml --dest ./result.json')
    .example('node $0 -s ./bigXML.xml -d ./result.json')
    .alias('s', 'src')
    .alias('d', 'dest')
    .describe('s', 'Source XML file')
    .describe('d', 'Destination JSON file')
    .demandOption(['s', 'd'])
    .help('h')
    .alias('h', 'help')
    .argv;

const fs        = require('fs');
const sax       = require('sax');
const strict    = true; // set to false for html-mode
const saxStream = sax.createStream(strict, {
    lowercase: true,
    xmlns: true
});
const Json2csvTransform = require('json2csv').Transform;

const src  = argv.src;
const dest = argv.dest;

let filterWorksRegexp = [
    'онкол',
    'гематол',
    'трансфуз',
    'физиотер',
    'рефлексотер',
    'лечебн[а-я]{0,9}\\s{0,}физ',
    'мануал[а-я]{0,9}\\s{0,}тер',
    'мед[а-я]{0,20}\\s{0,}мас'
];
let exclude = {
    activity_type: 'армацевтическая\\sдеятельность'
};

let fileSizeInBytes   = fs.statSync(src).size;
let totalBytesRead    = 0;
let totalOrgs         = 0;
let ORG               = {};
let TAG               = null;
let CAN_ADD_ORG_FIELD = false;
let ORGfields         = [
    'ogrn', 'inn', 'full_name_licensee', 'address', '_works', 'activity_type', 'name', 'information_reissuing',
    'abbreviated_name_licensee', 'index', 'region', 'city', 'street', 'number', 'date', 'date_register',
    'date_duplicate', 'termination', 'date_termination', 'information_suspension_resumption', 'information_cancellation'
];

let inWorks           = false;
let start             = true;

let wStream = fs.createWriteStream(dest);
wStream.write('[');

function needToAddORG (org) {
    for (let _field in exclude) {
        if (org[_field] && (new RegExp(exclude[_field], 'gim')).test(org.activity_type)) {
            return false;
        }
    }

    for (let i = 0, l = org._works.length; i < l; i++) {
        let add = filterWorksRegexp.some(re => (new RegExp(re, 'gim')).test(org._works[i]));

        if (add) return true;
    }

    return false;
}

function addOrgToResult (_ORG) {
    if (!_ORG._works) _ORG._works = [];

    if (needToAddORG(_ORG)) {
        for (let k in _ORG) {
            if (!ORGfields.some(f => f == k)) {
                delete _ORG[k];
            }
        }
        _ORG.works = [].concat(_ORG._works).filter(work => {
            return filterWorksRegexp.some(re => (new RegExp(re, 'gim')).test(work))
        });

        delete _ORG._works;

        wStream.write((start ? '\n' : ',\n') + JSON.stringify(_ORG, null, '\t'));
        ++totalOrgs;
        if (start) start = false;
        ORG = {};
    }
}

saxStream.on('text', text => {
    if (TAG && text.trim() && CAN_ADD_ORG_FIELD) {
        ORG[TAG] = text.trim();
        return;
    }
    if (inWorks && 'work' == TAG && text.trim()) {
        if (!('_works' in ORG)) ORG._works = [];
        ORG._works.push(text.trim());
    }
});

saxStream.on('opentag', node => {
    TAG = node.name;
    if ('licenses' == node.name) {
        CAN_ADD_ORG_FIELD = true;
    }
    if ('work_address_list' == node.name) {
        CAN_ADD_ORG_FIELD = false;
        inWorks = true;
    }
});

saxStream.on('closetag', tagName => {
    TAG = null;
    if ('licenses' == tagName) {
        CAN_ADD_ORG_FIELD = false;
        addOrgToResult(ORG);
    } else if ('work_address_list' == tagName) {
        CAN_ADD_ORG_FIELD = true;
        inWorks = false;
    }
});

let rStream = fs.createReadStream(src)
    .pipe(saxStream);

let file1percent = fileSizeInBytes / 100;
let progress = 0;
process.stdout.write('\rPROGRESS JSON: ' + progress + '%');
rStream.on('data', chunk => {
    totalBytesRead += Buffer.byteLength(chunk);
    let currentProgress = Number((totalBytesRead / file1percent).toFixed());
    if (currentProgress > progress) {
        progress = currentProgress;
        process.stdout.write('\rPROGRESS JSON: ' + progress + '%');
    }
});

rStream.on('end', () => {
    wStream.end('\n]');
    createCSVFromResultJSON();
});

function createCSVFromResultJSON () {
    const input           = fs.createReadStream(dest, { encoding: 'utf8' });
    const output          = fs.createWriteStream(dest.replace(/\.[a-z]{1,6}/i, '.csv'), { encoding: 'utf8' });
    const fileSizeInBytes = fs.statSync(dest).size;
    const file1percent    = fileSizeInBytes / 100;
    let totalBytesRead    = 0;
    let progress          = 0;

    const csvFields = ORGfields.filter(f => f !== '_works').concat('works');
    const json2csv  = new Json2csvTransform({
        fields: csvFields,
        delimiter: '^*^',
        quote: ''
    }, { highWaterMark: 16384, encoding: 'utf-8' });


    process.stdout.write('\n\rPROGRESS CSV: ' + progress + '%');

    input.pipe(json2csv).pipe(output);

    input
        .on('data', chunk => {
            totalBytesRead += Buffer.byteLength(chunk);
            let currentProgress = Number((totalBytesRead / file1percent).toFixed());
            if (currentProgress > progress) {
                progress = currentProgress;
                process.stdout.write('\rPROGRESS CSV: ' + progress + '%');
            }
        })
        .on('end', () => {
            console.info('\nORGANIZATIONS FOUNDED: ' + totalOrgs);
        });

    json2csv
        .on('error', console.error);
}
