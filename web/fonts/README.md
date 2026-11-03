# Fonts for the server rasteriser

`NotoSans-Regular.ttf` is Noto Sans (Latin subset), copyright Google LLC,
licensed under the SIL Open Font License 1.1 (https://openfontlicense.org).
It is the same file Next ships for `@vercel/og`.

`lib/critic/render.ts` hands it to resvg. A Vercel function has no system
fonts, so without it every label on a rendered screen comes out blank.
