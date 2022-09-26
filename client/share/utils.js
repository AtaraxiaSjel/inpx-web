import {Buffer} from 'safe-buffer';
//import _ from 'lodash';

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function toHex(buf) {
    return Buffer.from(buf).toString('hex');
}

export function keyEventToCode(event) {
    let result = [];
    let code = event.code;

    const modCode = code.substring(0, 3);
    if (event.metaKey && modCode != 'Met')
        result.push('Meta');
    if (event.ctrlKey && modCode != 'Con')
        result.push('Ctrl');
    if (event.shiftKey && modCode != 'Shi')
        result.push('Shift');
    if (event.altKey && modCode != 'Alt')
        result.push('Alt');
    
    if (modCode == 'Dig') {
        code = code.substring(5, 6);
    } else if (modCode == 'Key') {
        code = code.substring(3, 4);
    }
    result.push(code);

    return result.join('+');
}

export function wordEnding(num, type = 0) {
    const endings = [
        ['ов', '', 'а', 'а', 'а', 'ов', 'ов', 'ов', 'ов', 'ов'],
        ['й', 'я', 'и', 'и', 'и', 'й', 'й', 'й', 'й', 'й'],
        ['о', '', 'о', 'о', 'о', 'о', 'о', 'о', 'о', 'о'],
        ['ий', 'ие', 'ия', 'ия', 'ия', 'ий', 'ий', 'ий', 'ий', 'ий']
    ];
    const deci = num % 100;
    if (deci > 10 && deci < 20) {
        return endings[type][0];
    } else {
        return endings[type][num % 10];
    }
}

export async function copyTextToClipboard(text) {
    let result = false;
    try {
        await navigator.clipboard.writeText(text);
        result = true;
    } catch (e) {
        //
    }

    return result;
}

export function makeValidFilename(filename, repl = '_') {
    let f = filename.replace(/[\x00\\/:*"<>|]/g, repl); // eslint-disable-line no-control-regex
    f = f.trim();
    while (f.length && (f[f.length - 1] == '.' || f[f.length - 1] == '_')) {
        f = f.substring(0, f.length - 1);
    }

    if (f)
        return f;
    else
        throw new Error('Invalid filename');
}
