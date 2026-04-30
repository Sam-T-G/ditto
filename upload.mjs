import fs from 'fs';
const fileData = fs.readFileSync('dummy.pdf');
const formData = new FormData();
formData.append('file', new Blob([fileData], { type: 'application/pdf' }), 'dummy.pdf');

fetch('http://localhost:3000/api/process-pdf', {
  method: 'POST',
  body: formData
}).then(res => res.text()).then(console.log).catch(console.error);
