# PUBMAXX Pub Pal launch character sheets

Status: implementation contract for Fable visual review. Launch has seven companion forms: Circuit Robin, Greyhound, and Black Cat use approved mascot bitmaps, and four alternates are original layered SVGs. No third-party character artwork is embedded or traced.

All companions share the same capability and the same eight state vocabulary: idle, noticing, listening, thinking, speaking, celebrating, sleeping, and error. Motion communicates state only. Reduced-motion mode freezes each rig into the corresponding static pose.

| Companion | Silhouette and face | Signature prop | Material | Idle pose |
|---|---|---|---|---|
| Circuit Robin | Warm amber signal chest, bright eyes, grounded companion gaze | Signal seam | Smoked chrome with amber signal seam | Upright and ready beside the route |
| Greyhound | Long nose, swept ears, loyal bright eyes | Signal collar | Smoked chrome with amber signal seam | Upright, leaning gently into the route |
| Black Cat | Compact body, hooked tail, half-lidded luminous eyes | Brass bell beacon | Black glass with a soft edge glow | Seated with one paw lifted |
| Fox | Sharp ears, tapered muzzle, curious eyes, curled tail | Route compass | Copper hologram with glass highlights | Forward on its toes |
| Pigeon | Round city-bird chest, side-eye, proud head angle | Transit tag | Oil-slick chrome with teal and violet bands | One foot forward, listening to the street |
| Badger | Low broad body, strong face stripes, steady eyes | Night-key lantern | Brushed graphite and frosted signal glass | Planted firmly with the lantern close |
| Corgi | Short body, oversized ears, open grin | Crew-band harness | Warm chrome with cream glass panels | Front paws wide, ready to celebrate |

Legacy compatibility remains explicit. Stored `hound`, `raven`, `rabbit`, `turtle`, `squirrel`, and `bot` values remain valid. Historical `black-cat`, `black_cat`, `night-bot`, and `night_bot` aliases normalize at the trust boundary without rewriting existing records.

## Review checklist

- The seven forms remain distinguishable at 36px and full portrait size.
- Every legacy SVG rig has face, prop, back, body, head, signal, and shadow layers; Circuit Robin, Greyhound, and Black Cat use the approved mascot asset pipeline.
- Hologram, chrome, and glass treatments preserve the same geometry.
- Listening, thinking, speaking, celebrating, sleeping, and error states do not imply an unconfirmed action.
- No alcohol quantity, ranking, or reward behavior is encoded in the character system.
- Black Cat is a signal companion, not a realistic animal illustration; Pigeon and Badger retain clear London-street personality without copying a known character.
