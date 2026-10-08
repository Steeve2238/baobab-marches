/**
 * Archive ZIP minimale (methode deflate), sans dependance : suffisant pour regrouper les imprimables d'une periode de paie.
 * entrees : [{ nom, contenu: Buffer, date? }]
 */
const zlib = require("zlib");

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosDate(d) {
  const y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

function creerZip(entrees) {
  const parts = [];
  const centrale = [];
  let offset = 0;
  for (const e of entrees) {
    const nom = Buffer.from(e.nom, "utf8");
    const brut = Buffer.isBuffer(e.contenu) ? e.contenu : Buffer.from(e.contenu);
    const comp = zlib.deflateRawSync(brut);
    const crc = crc32(brut);
    const { time, date } = dosDate(e.date || new Date());
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(brut.length, 22);
    local.writeUInt16LE(nom.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nom, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(brut.length, 24);
    c.writeUInt16LE(nom.length, 28);
    c.writeUInt32LE(offset, 42);
    centrale.push(c, nom);
    offset += local.length + nom.length + comp.length;
  }
  const dirBuf = Buffer.concat(centrale);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entrees.length, 8);
  fin.writeUInt16LE(entrees.length, 10);
  fin.writeUInt32LE(dirBuf.length, 12);
  fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dirBuf, fin]);
}

module.exports = { creerZip };
