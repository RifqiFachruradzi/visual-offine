# Sprite karakter 3D (office_cast_lineup.glb)

`assets/cast/office_cast_lineup.glb` berisi 14 karakter (mesh statis, tanpa rig). `render.html`
memuatnya dengan three.js, memutar bagian kaki/lengan (berdasarkan nama mesh `left_trouser`,
`right_sleeve`, …) untuk pose, lalu merender sprite sheet `assets/cast/cast-NN.png` + `cast.json`.

Baris: depan, belakang, samping (kanan). Kolom: idle, jalan ×4, duduk, mengetik ×2, sorak.

Render ulang:
```bash
cd tools/cast
npm i three@0.160.0
cp ../../assets/cast/office_cast_lineup.glb cast.glb
python3 -m http.server 4610 --bind 127.0.0.1 &
node render.cjs ../../assets/cast        # butuh Playwright + Chromium
```
