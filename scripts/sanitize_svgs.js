const fs = require('fs');
const files = [
  'doc/assets/architecture.svg',
  'doc/assets/admin-preview.svg',
  'doc/assets/simulator-preview.svg',
  'doc/assets/tech-stack.svg'
];
for (const f of files) {
  let t = fs.readFileSync(f, 'utf8');
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '-');
  t = t.replace(/[\u2018\u2019]/g, "'");
  t = t.replace(/[\u201C\u201D]/g, '"');
  t = t.replace(/\u00B7/g, '/');
  t = t.replace(/\u2605/g, '*');
  t = t.replace(/\u2192/g, '->');
  if (!t.startsWith('<?xml')) {
    t = '<?xml version="1.0" encoding="UTF-8"?>\n' + t;
  }
  fs.writeFileSync(f, t, 'utf8');
  const bad = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(t);
  console.log(f, 'stillBad=' + bad, 'len=' + t.length);
}
