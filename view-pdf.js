import fs from 'fs';
const base64 = Buffer.from(fs.readFileSync('dummy.pdf')).toString('base64');
console.log(base64);
