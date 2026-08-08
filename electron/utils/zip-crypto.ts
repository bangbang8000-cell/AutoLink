/**
 * V3.3.2-T15-2: ZIP 传统加密（PKWARE ZipCrypto）
 *
 * adm-zip 仅支持"读取"加密 ZIP，不支持"创建"加密 ZIP；
 * 这里实现 ZipCrypto 加密并把现有 ZIP 重写为加密版本（标准工具/7-Zip/资源管理器均可解压）。
 * 安全说明：ZipCrypto 为传统弱加密，适用于"防误读"场景，非高强度加密。
 */
import * as fs from 'fs'
import { randomBytes } from 'crypto'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32Byte(crc: number, b: number): number {
  return ((crc >>> 8) ^ CRC_TABLE[(crc ^ b) & 0xff]) >>> 0
}

/** ZipCrypto 密钥流（每个 zip 用同一密码，每个条目重新派生） */
class ZipCrypto {
  private k0 = 0x12345678
  private k1 = 0x23456789
  private k2 = 0x34567890

  constructor(password: string) {
    for (let i = 0; i < password.length; i++) this.update(password.charCodeAt(i) & 0xff)
  }

  private update(c: number): void {
    this.k0 = crc32Byte(this.k0, c)
    this.k1 = (this.k1 + (this.k0 & 0xff)) >>> 0
    this.k1 = (Math.imul(this.k1, 134775813) + 1) >>> 0
    this.k2 = crc32Byte(this.k2, this.k1 >>> 24)
  }

  private decryptByte(): number {
    const temp = (this.k2 | 2) & 0xffff
    return ((temp * (temp ^ 1)) >>> 8) & 0xff
  }

  /** 加密数据（密钥状态随明文推进，与标准解密器对称） */
  encrypt(data: Buffer): Buffer {
    const out = Buffer.alloc(data.length)
    for (let i = 0; i < data.length; i++) {
      const c = data[i]
      out[i] = (c ^ this.decryptByte()) & 0xff
      this.update(c)
    }
    return out
  }
}

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50

interface CentralEntry {
  /** 该中央目录记录在源 zip 中的起始偏移 */
  srcOffset: number
  localOffset: number
  flag: number
  method: number
  crc: number
  csize: number
  usize: number
  fnameLen: number
  extraLen: number
  commentLen: number
  fname: string
}

/** 从 zip 尾部定位 EOCD */
function findEOCD(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 65535)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i
  }
  throw new Error('无效的 ZIP 文件（未找到 EOCD）')
}

function parseCentral(buf: Buffer, cdOffset: number, cdSize: number): CentralEntry[] {
  const entries: CentralEntry[] = []
  let pos = cdOffset
  const end = cdOffset + cdSize
  while (pos + 46 <= end) {
    if (buf.readUInt32LE(pos) !== CENTRAL_SIG) break
    const flag = buf.readUInt16LE(pos + 8)
    const method = buf.readUInt16LE(pos + 10)
    const crc = buf.readUInt32LE(pos + 16)
    const csize = buf.readUInt32LE(pos + 20)
    const usize = buf.readUInt32LE(pos + 24)
    const fnameLen = buf.readUInt16LE(pos + 28)
    const extraLen = buf.readUInt16LE(pos + 30)
    const commentLen = buf.readUInt16LE(pos + 32)
    const localOffset = buf.readUInt32LE(pos + 42)
    const fname = buf.toString('utf8', pos + 46, pos + 46 + fnameLen)
    entries.push({ srcOffset: pos, localOffset, flag, method, crc, csize, usize, fnameLen, extraLen, commentLen, fname })
    pos += 46 + fnameLen + extraLen + commentLen
  }
  return entries
}

/**
 * 将 zipPath 重写为 ZipCrypto 加密版本（覆盖原文件）。
 * - 文件条目：local header 置 bit0（encrypted），数据前插 12 字节加密头，压缩数据加密
 * - 统一清除 bit3（data descriptor），把 CRC/大小写入 local header，保证工具兼容
 * - 目录条目（无数据）保持原样（标准 zip 中目录不加密）
 */
export function encryptZipFile(zipPath: string, password: string): void {
  if (!password) throw new Error('加密密码不能为空')
  const buf = fs.readFileSync(zipPath)
  const eocd = findEOCD(buf)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const totalEntries = buf.readUInt16LE(eocd + 10)

  const central = parseCentral(buf, cdOffset, cdSize)
  if (central.length !== totalEntries) {
    throw new Error('ZIP 中央目录条目数不一致')
  }

  const parts: Buffer[] = []
  const newOffsets: number[] = []

  for (const c of central) {
    const isDir = c.method === 0 && c.csize === 0 && c.fname.endsWith('/')
    const lh = c.localOffset
    if (buf.readUInt32LE(lh) !== LOCAL_SIG) {
      throw new Error(`ZIP 本地头损坏: ${c.fname}`)
    }
    const lFnameLen = buf.readUInt16LE(lh + 26)
    const lExtraLen = buf.readUInt16LE(lh + 28)
    const fnameBuf = buf.slice(lh + 30, lh + 30 + lFnameLen)
    const extraBuf = buf.slice(lh + 30 + lFnameLen, lh + 30 + lFnameLen + lExtraLen)
    const dataStart = lh + 30 + lFnameLen + lExtraLen

    newOffsets.push(parts.reduce((acc, p) => acc + p.length, 0))

    if (isDir) {
      // 目录条目：原样复制 local header 区（含名称/extra）
      parts.push(buf.slice(lh, dataStart))
      continue
    }

    // 加密头（12 字节）：11 随机 + 1 校验字节（crc 高字节，因 bit3 已清）
    const encHeaderRaw = Buffer.alloc(12)
    randomBytes(11).copy(encHeaderRaw, 0)
    encHeaderRaw[11] = (c.crc >>> 24) & 0xff

    const compressed = buf.slice(dataStart, dataStart + c.csize)
    if (compressed.length !== c.csize) {
      throw new Error(`ZIP 数据区不完整: ${c.fname}`)
    }

    const crypto = new ZipCrypto(password)
    const encHeader = crypto.encrypt(encHeaderRaw)
    const encData = crypto.encrypt(compressed)

    // 重写 local header：bit0=encrypted，清除 bit3，写入 CRC/大小
    const newFlag = (c.flag & ~8) | 1
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(LOCAL_SIG, 0)
    localHeader.writeUInt16LE(20, 4) // version needed to extract
    localHeader.writeUInt16LE(newFlag, 6)
    localHeader.writeUInt16LE(c.method, 8)
    localHeader.writeUInt16LE(buf.readUInt16LE(lh + 10), 10) // last mod time
    localHeader.writeUInt16LE(buf.readUInt16LE(lh + 12), 12) // last mod date
    localHeader.writeUInt32LE(c.crc, 14)
    localHeader.writeUInt32LE(c.csize + 12, 18)
    localHeader.writeUInt32LE(c.usize, 22)
    localHeader.writeUInt16LE(c.fnameLen, 26)
    localHeader.writeUInt16LE(c.extraLen, 28)

    parts.push(localHeader)
    parts.push(fnameBuf)
    parts.push(extraBuf)
    parts.push(encHeader)
    parts.push(encData)
  }

  // 新 local 区总长度（新中央目录起点）
  let newLocalSize = 0
  for (const p of parts) newLocalSize += p.length

  // 重写中央目录
  const centralParts: Buffer[] = []
  for (let i = 0; i < central.length; i++) {
    const c = central[i]
    const isDir = c.method === 0 && c.csize === 0 && c.fname.endsWith('/')
    const recLen = 46 + c.fnameLen + c.extraLen + c.commentLen
    const rec = Buffer.from(buf.slice(c.srcOffset, c.srcOffset + recLen))

    if (!isDir) {
      // 更新：flag（bit0=encrypted、清 bit3）、csize+12、local header offset
      const newFlag = (c.flag & ~8) | 1
      rec.writeUInt16LE(newFlag, 8)
      rec.writeUInt32LE(c.crc, 16)
      rec.writeUInt32LE(c.csize + 12, 20)
      rec.writeUInt32LE(c.usize, 24)
      rec.writeUInt32LE(newOffsets[i], 42)
    } else {
      rec.writeUInt32LE(newOffsets[i], 42)
    }
    centralParts.push(rec)
  }

  const newCentralSize = centralParts.reduce((acc, p) => acc + p.length, 0)

  // 重写 EOCD：更新中央目录偏移/大小（entries 数不变）
  const newEocd = Buffer.alloc(22)
  newEocd.writeUInt32LE(EOCD_SIG, 0)
  newEocd.writeUInt16LE(buf.readUInt16LE(eocd + 4), 4)
  newEocd.writeUInt16LE(buf.readUInt16LE(eocd + 6), 6)
  newEocd.writeUInt16LE(buf.readUInt16LE(eocd + 8), 8)
  newEocd.writeUInt16LE(buf.readUInt16LE(eocd + 10), 10)
  newEocd.writeUInt32LE(newCentralSize, 12)
  newEocd.writeUInt32LE(newLocalSize, 16)
  newEocd.writeUInt16LE(0, 20) // comment len

  const out = Buffer.concat([...parts, ...centralParts, newEocd])
  fs.writeFileSync(zipPath, out)
}
