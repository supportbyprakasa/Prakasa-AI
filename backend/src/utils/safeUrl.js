// URL checks shared by route schemas and services (security review, Oct 2026).
//
//   httpsUrl({ max })        zod schema for a link people click (portal, KantorKu
//                            reference, logo): https:// only, so a stored
//                            "javascript:" or "data:" value can never become a link.
//   assertSafeGatewayUrl()   for an address the SERVER calls (AI gateways): https://
//                            only (http://localhost allowed outside production) and,
//                            in production, never a private, loopback, link-local
//                            or cloud-metadata address — checked after DNS
//                            resolution, so a public name pointing inside fails too.
const dns = require('node:dns');
const net = require('node:net');
const { z } = require('zod');

function parseUrl(value) {
  try { return new URL(String(value)); } catch { return null; }
}

function isHttps(value) {
  return parseUrl(value)?.protocol === 'https:';
}

function httpsUrl({ max = 500, message = 'Alamat harus diawali https://' } = {}) {
  return z.string().trim().max(max).url('Alamat tidak valid').refine(isHttps, message);
}

// ------------------------------------------------------------ address ranges

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc * 256) + Number(part), 0);
}

const PRIVATE_V4 = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata (169.254.169.254)
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
].map(([base, bits]) => [ipv4ToInt(base), bits]);

function isPrivateIpv4(ip) {
  const value = ipv4ToInt(ip);
  return PRIVATE_V4.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    return value >= base && value < base + size;
  });
}

function isPrivateIpv6(ip) {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === '::' || lower === '::1') return true;
  // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible forms.
  const mapped = lower.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/) || lower.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  const first = parseInt(lower.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if (lower.startsWith('fd00:ec2::254')) return true; // AWS metadata over IPv6
  return false;
}

/** True for loopback, private, link-local, CGNAT and metadata addresses. */
function isPrivateAddress(address) {
  const ip = String(address || '').replace(/^\[|\]$/g, '');
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return false;
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function gatewayError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

/**
 * Throws a 400 VALIDATION_ERROR when `value` may not be used as a gateway the
 * server calls. `lookup` is injectable for tests (defaults to DNS, all records).
 */
async function assertSafeGatewayUrl(value, { env = process.env, lookup = dns.promises.lookup } = {}) {
  const url = parseUrl(value);
  if (!url || !['https:', 'http:'].includes(url.protocol)) throw gatewayError('URL gateway tidak valid');
  if (url.username || url.password) throw gatewayError('URL gateway tidak boleh memuat nama pengguna atau kata sandi');

  const production = env.NODE_ENV === 'production';
  const host = url.hostname.toLowerCase();
  if (url.protocol === 'http:') {
    if (production || !LOCAL_HOSTNAMES.has(host)) {
      throw gatewayError('URL gateway harus diawali https:// (http hanya untuk localhost saat pengembangan)');
    }
    return url.toString();
  }
  if (!production) return url.toString();

  if (LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw gatewayError('URL gateway tidak boleh mengarah ke server ini atau jaringan internal');
  }
  let addresses;
  try {
    const bare = host.replace(/^\[|\]$/g, '');
    addresses = net.isIP(bare) ? [{ address: bare }] : await lookup(bare, { all: true });
  } catch {
    throw gatewayError('Alamat gateway tidak ditemukan (DNS)');
  }
  const list = Array.isArray(addresses) ? addresses : [addresses];
  if (!list.length || list.some((entry) => isPrivateAddress(entry?.address ?? entry))) {
    throw gatewayError('URL gateway tidak boleh mengarah ke server ini atau jaringan internal');
  }
  return url.toString();
}

module.exports = { httpsUrl, isHttps, isPrivateAddress, assertSafeGatewayUrl };
