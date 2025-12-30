const PBKDF2_ITERS = 100000; // <= 100000 (Cloudflare limit)

async function makePasswordBundle(password) {
  // 1) random salt
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);

  // 2) pbkdf2
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes,
      iterations: PBKDF2_ITERS,
    },
    keyMaterial,
    256 // 32 bytes
  );

  const hashBytes = new Uint8Array(bits);

  return {
    password_salt: toBase64(saltBytes),
    password_hash: toBase64(hashBytes),
    password_iters: PBKDF2_ITERS,
  };
}

function toBase64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
