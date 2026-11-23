// 极简 PNG 编码器 + 抽象封面绘制（零依赖）。
// 用途：给示例文章生成 featured image，避免流水线依赖外部图床。
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
	const t = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c;
	}
	return t;
})();

function crc32(buf) {
	let c = -1;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([len, body, crc]);
}

/** rgba: Buffer/Uint8Array 长度 w*h*4 */
export function encodePng(width, height, rgba) {
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0; // filter: none
		Buffer.from(rgba.buffer ?? rgba, rgba.byteOffset ?? 0, rgba.length).copy(
			raw,
			y * (stride + 1) + 1,
			y * stride,
			(y + 1) * stride
		);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const mix = (a, b, t) => a.map((v, i) => clamp(Math.round(v + (b[i] - v) * t)));

/** 确定性伪随机（便于重复构建得到同一张图） */
function rng(seed) {
	let s = seed >>> 0 || 1;
	return () => {
		s ^= s << 13;
		s >>>= 0;
		s ^= s >> 17;
		s ^= s << 5;
		s >>>= 0;
		return s / 4294967296;
	};
}

/**
 * 生成一张 1200x800 的抽象封面：对角渐变 + 三个柔光圆斑 + 细网格。
 * @param {number} seed
 */
export function coverPng(seed = 1, width = 1200, height = 800) {
	const rand = rng(seed * 2654435761);
	// 与 TT3 默认调色板同族的深色系，配荧光绿点缀
	const palettes = [
		[[18, 20, 17], [52, 92, 0], [157, 255, 32]],
		[[24, 24, 26], [46, 46, 52], [157, 255, 32]],
		[[12, 34, 24], [22, 74, 44], [180, 255, 96]],
		[[30, 24, 34], [58, 44, 64], [157, 255, 32]],
		[[20, 28, 38], [34, 62, 84], [120, 220, 255]],
	];
	const [c0, c1, accent] = palettes[seed % palettes.length];
	const spots = [0, 1, 2].map(() => ({
		x: rand() * width,
		y: rand() * height,
		r: (0.18 + rand() * 0.28) * Math.min(width, height),
	}));
	const rgba = Buffer.alloc(width * height * 4);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const t = 0.12 + 0.8 * ((x / width) * 0.6 + (y / height) * 0.4);
			let col = mix(c0, c1, Math.min(1, t));
			for (const s of spots) {
				const d = Math.hypot(x - s.x, y - s.y) / s.r;
				if (d < 1) col = mix(col, accent, 0.42 * Math.pow(1 - d, 2.2));
			}
			// 柔和的大尺度色带，避免逐像素噪点（PNG 压缩率会好很多）
			const band = Math.sin((x * 0.008 + y * 0.014) + seed) * 0.5 + 0.5;
			const k = 1 + (band - 0.5) * 0.06;
			const i = (y * width + x) * 4;
			rgba[i] = clamp(col[0] * k);
			rgba[i + 1] = clamp(col[1] * k);
			rgba[i + 2] = clamp(col[2] * k);
			rgba[i + 3] = 255;
		}
	}
	return encodePng(width, height, rgba);
}
