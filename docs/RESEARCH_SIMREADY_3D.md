# Research: NVIDIA SimReady assets for a 3D web dashboard

Question (2026-10-29): should HMI Copilot integrate NVIDIA's SimReady Central library, converting its OpenUSD assets to glTF and showing them in a Three.js dashboard? Research only; nothing implemented.

Source post (pasted by Shaurya) claimed a link, a USD-to-GLB script, physics data on every asset, and a Three.js demo. Each claim was checked below. Stray codes in the pasted text were ignored.

## Verdict

**Do not integrate into HMI Copilot.** The product generates Schneider OTE screens (2D, ISA-101 style). OTE cannot load GLB or USD objects, so a 3D asset cannot become a screen object. The product already has its own visual library: 475 shipped OTE graphic objects, indexed in `web/src/lib/ote/graphics-index.json`, which OTE draws natively. That is the right source for equipment symbols.

A 3D dashboard is a different product (a digital-twin viewer). Revisit only if a customer asks for 3D visualisation, and then build it as a separate app, not inside the copilot.

## What was verified

| Claim in the post | Verified | Source |
|---|---|---|
| Dataset on Hugging Face, `nvidia/simready-assets` | Yes | [HF dataset page](https://huggingface.co/datasets/nvidia/simready-assets) |
| "~2,500-3,000 assets" | Close: the page says **2,673** | HF dataset page |
| "472 GB" | No: the page says **489 GB** | HF dataset page |
| Formats: OpenUSD | Yes. Files are `.usd` and `.usda`. **No GLB or glTF** on the page | HF dataset page |
| License CC-BY-4.0 | Partly. The dataset page is tagged `cc-by-4.0`, but the central library says contributors "can apply any license of your choice to your dataset, including a non-commercial license" | [SimReady Central docs](https://docs.omniverse.nvidia.com/simready/latest/simready-central.html) |
| Browse by natural language at `hf.co/spaces/nvidia/simready-central` | Not checked | — |
| `convert_simready.py` (USD to GLB, Z-up to Y-up, textures packed) | **Not found.** The SimReady Central repo has no convert, fetch or glb script | [GitHub repo](https://github.com/NVIDIA-Omniverse/simready-central); search for `convert_simready.py` returned nothing |
| `fetch_assets.py` | **Not found** under that name. The repo's only fetch path is an index-to-library skill that needs a one-time setup | same repo |
| Each asset has mass, friction and collision data | **Not confirmed.** The docs mention "power, thermal, and network specifications" and validation rules; they do not list mass, friction or collision | SimReady Central docs |
| "SimReady Storeroom" Three.js demo, and a warehouse dashboard by a named creator | Not checked | — |

Three.js side, verified: the built-in USDZ loader reads only USDA, not USDC. Maintainers advise converting to glTF and loading it with `GLTFLoader` instead. [Three.js USDLoader docs](https://threejs.org/docs/pages/USDLoader.html); [discussion](https://discourse.threejs.org/t/usdz-loader-for-three-js/35357).

## Licensing, if we ever used it

- Each asset's license is set by its contributor's Hugging Face dataset, not by NVIDIA. The central library says there is no single licence for the whole set. Check each dataset card before use.
- CC-BY-4.0 requires attribution to the creator in the product. Every asset used would need a credit line.
- NVIDIA says only CC-BY-4.0 datasets are distributed in China and included in Isaac Sim browser experiences. A Schneider product sold in China would have to filter by licence.
- At 489 GB, the library must never be bundled in the app. Any use would download single assets on demand.

## Technical path, if ever needed

1. Pick assets by name or metadata, and download only those files from Hugging Face.
2. Convert USD to glTF offline, with Blender's USD importer and glTF exporter, or with Pixar's USD tools. Expect to check the result by eye, since the converter choice is not documented by NVIDIA.
3. Load the `.glb` with `GLTFLoader` in Three.js or React Three Fiber.
4. Physics data (mass, friction) does not survive glTF. A dashboard that needs physics must read the USD file directly, which means a WebAssembly USD parser. Otherwise the assets are only visual.

Browser USD support is still limited. A WebAssembly viewer exists (Needle's USD Viewer), but it is a large dependency, and a maintainer advises against building a native USD loader for Three.js. [Forum thread](https://forum.aousd.org/t/state-of-the-art-for-viewing-usdz-on-web/2344).

## Options

| Option | Fit with the product | Cost | Recommendation |
|---|---|---|---|
| A. Use the SimReady library in HMI Copilot | None: OTE cannot show 3D | High | No |
| B. Use shipped OTE graphic objects (already in the repo) | Strong: OTE draws them natively | Already built | Yes, keep |
| C. Separate 3D digital-twin viewer, built later | Weak for this product | Large: USD to glTF pipeline, asset download, licence filter, large bundle | Only if a customer asks |
| D. Render one 3D asset to a PNG and place it in an OTE Image object | Possible, but poor: static and off-style | Medium | No |

## What to tell Shaurya and Krishnadas

- The library is real and usable, but its key claims in the post are wrong or unverified: the size, the scripts, the physics data, and the GLB output.
- It does not match what OTE can display, so it adds no value to the copilot's screens.
- If a 3D view is wanted, scope it as a separate product, with its own licence check per asset and a glTF pipeline.

## Sources

- [SimReady Central Library docs](https://docs.omniverse.nvidia.com/simready/latest/simready-central.html)
- [NVIDIA SimReady Central GitHub repo](https://github.com/NVIDIA-Omniverse/simready-central)
- [nvidia/simready-assets dataset page on Hugging Face](https://huggingface.co/datasets/nvidia/simready-assets)
- [Three.js USDLoader docs](https://threejs.org/docs/pages/USDLoader.html)
- [Three.js forum: USDZ loader](https://discourse.threejs.org/t/usdz-loader-for-three-js/35357)
- [AOUSD forum: viewing USDZ on the web](https://forum.aousd.org/t/state-of-the-art-for-viewing-usdz-on-web/2344)

Not verified: the "SimReady Storeroom" Three.js demo, the warehouse dashboard credited in the post, and the natural-language search space.
