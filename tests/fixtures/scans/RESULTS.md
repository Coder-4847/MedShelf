# Measured scan accuracy (synthetic fixtures)

**Read this first.** These are 12 *synthetic* photos (105 boxes) rendered by `scripts/gen-fixtures.mjs`:
boxes at random rotations on a table, six fonts, three label layouts, shadows, blur, noise, glare and
low light, with real GS1 DataMatrix codes. Brand names are invented placeholders plus a few real UAE
brands/generics. They are **not** photos of real packaging, which has glossy foil, curved surfaces,
dense multilingual print (including Arabic, which the bundled recogniser cannot read), and brand
logos. Expect real-world accuracy to be lower; treat these numbers as a regression benchmark and an
upper bound, not a promise. The grouping/matching parameters were tuned while looking at these
images, so they are also somewhat optimistic by construction.

Timings are single-threaded ONNX Runtime WASM in Node on a 4-core cloud VM with no other load, not
a phone. Browser runs of the same fixtures on this machine took 5-7 s in fast mode.

Reproduce: `npm run gen:fixtures`, then
`npx vitest run --config vitest.eval.config.ts score` (fast) or
`EVAL_MODE=thorough npx vitest run --config vitest.eval.config.ts score`.

## Known failure modes seen in these runs

- Two or three touching boxes with unknown (not in drug list) names can be merged into one candidate
  (scan-06). The review UI flags merged clusters it notices, but one case in thorough mode was shown
  as a confident, wrong name. This is the most important known error.
- Invented names within a letter or two of a real drug (e.g. "Orelix" vs "Orelox") are *suggested* as
  that drug, always flagged "Check this", never presented as confident.
- Text printed as a coloured pill (white on colour) is sometimes missed, so strength/form are empty.
- Form is only filled when the form word is read ("tablets") or the drug list implies one form.
- Expiry/batch from printed text rely on small print; DataMatrix gives exact values when present.
- Fine print on boxes is often unreadable at working resolution; "thorough" mode helps.

## Fast mode (default)

| image | boxes | detected | name OK | extra candidates | DataMatrix read/expected | unlinked codes | seconds |
|---|---|---|---|---|---|---|---|
| scan-01-aligned-easy | 6 | 6 | 6 | 0 | 5/5 | 1 | 4.7 |
| scan-02-aligned-mixed | 8 | 8 | 8 | 0 | 4/4 | 1 | 4.3 |
| scan-03-aligned-dense | 10 | 10 | 10 | 0 | 5/5 | 0 | 6.8 |
| scan-04-aligned-light | 7 | 7 | 7 | 0 | 5/5 | 0 | 4.6 |
| scan-05-random-6 | 6 | 6 | 6 | 0 | 3/3 | 1 | 3.4 |
| scan-06-random-8 | 8 | 6 | 6 | 0 | 2/2 | 0 | 4.3 |
| scan-07-random-8b | 8 | 8 | 8 | 0 | 7/7 | 1 | 5.1 |
| scan-08-random-10 | 10 | 10 | 10 | 0 | 6/6 | 0 | 5.4 |
| scan-09-crowded-14 | 14 | 14 | 14 | 0 | 6/6 | 2 | 7.8 |
| scan-10-crowded-12 | 12 | 12 | 12 | 0 | 9/9 | 0 | 7.8 |
| scan-11-glare-dim | 8 | 8 | 8 | 0 | 4/4 | 0 | 4.2 |
| scan-12-lowlight-noisy | 8 | 8 | 8 | 0 | 4/4 | 0 | 4.3 |

- Boxes detected: 103/105 (98%)
- Name correct (exact 100 + near 3): 103/103 (100%) of detected; exact only 100/103 (97%)
- Wrong names: 0, of which presented WITHOUT a "Check this" flag: 0
- Known drug-list names (generic/brand) matched to the right entry: 70/70 (100%)
- Invented brands falsely matched to a drug-list entry: 3/33
- Strength correct: 90/98 (92%)
- Form correct: 72/103 (70%)
- Expiry correct (barcode or printed text): 57/92 (62%)
- Batch correct: 55/92 (60%)
- GTIN correct: 53/59 (90%)
- DataMatrix codes read: 60/60 (100%); linked to a candidate: 54/60 (90%)
- Extra candidates not on any box: 0; boxes split into >1 candidate: 0
- Mean time per photo: 5.2 s (Node WASM, single thread)

### Misses and errors
- scan-01-aligned-easy  expiry(DM) Zentora: want 2028-01-31 got 
- scan-02-aligned-mixed  FALSEMATCH Orelix -> Orelox
- scan-02-aligned-mixed  expiry(DM) Zyrtec: want 2026-08-31 got 
- scan-02-aligned-mixed  form Amoxicillin: want "Capsule" got ""  lines=["Amoxicillin","500 mg","sansdeg"]
- scan-05-random-6  form Loratadine: want "Tablet" got ""  lines=["10mg","Loratadine"]
- scan-05-random-6  form Calmexa: want "Tablet" got ""  lines=["Calmexa","100mg","12tabl"]
- scan-05-random-6  form Cetirizine: want "Tablet" got ""  lines=["10mg","Cetirizine"]
- scan-05-random-6  expiry(DM) Cetirizine: want 2027-01-31 got 
- scan-05-random-6  form Zentora: want "Tablet" got ""  lines=["10mg","Zentora","Eachtabl","ldeng"]
- scan-06-random-8  MISSED   Zentora 10 mg
- scan-06-random-8  form Lorvexa: want "Tablet" got ""  lines=["20mg","Lorvexa","2026"]
- scan-06-random-8  form Ventolin: want "Inhaler" got ""  lines=["Ventolin","100mcg","eatl"]
- scan-06-random-8  strength Augmentin: want "625 mg" got "150 mg"
- scan-06-random-8  form Augmentin: want "Tablet" got ""  lines=["150mg","Orelix","Augmentin","10mg","Zentora","625 mg"]
- scan-06-random-8  MISSED   Orelix 150 mg
- scan-07-random-8b  expiry(DM) Orelix: want 2026-10-31 got 
- scan-07-random-8b  FALSEMATCH Orelix -> Orelox
- scan-07-random-8b  form Cetirizine: want "Tablet" got ""  lines=["10mg","Cetirizine","acht"]
- scan-07-random-8b  form Amoxicillin: want "Capsule" got ""  lines=["500 mg","Amoxicillin"]
- scan-07-random-8b  form Veldrin: want "Capsule" got ""  lines=["Veldrin","250","mg","EXD","aci"]
- scan-07-random-8b  strength Zyrtec: want "10 mg" got ""
- scan-07-random-8b  form Zyrtec: want "Tablet" got ""  lines=["Zyrtec","omg"]
- scan-07-random-8b  form Brufen: want "Tablet" got ""  lines=["400mg","Brufen","ENK9"]
- scan-08-random-10  form Amoxicillin: want "Capsule" got ""  lines=["500mg","Amoxicillin"]
- scan-08-random-10  strength Nuvira: want "5 mg" got ""
- scan-08-random-10  form Nuvira: want "Tablet" got ""  lines=["10","Nuvira"]
- scan-08-random-10  strength Cetirizine: want "10 mg" got ""
- scan-08-random-10  form Cetirizine: want "Tablet" got ""  lines=["Comg","Cetirizine"]
- scan-08-random-10  form Veldrin: want "Capsule" got ""  lines=["Veldrin","250 mg"]
- scan-09-crowded-14  form Ibuprofen: want "Tablet" got ""  lines=["Ibuprofen","400mg"]
- scan-09-crowded-14  form Nuvira: want "Tablet" got ""  lines=["5mg","Nuvira","EXP09/","2026"]
- scan-09-crowded-14  strength Panadol: want "500 mg" got ""
- scan-09-crowded-14  form Cetirizine: want "Tablet" got ""  lines=["10mg","Cetirizine"]
- scan-09-crowded-14  expiry(DM) Veldrin: want 2026-12-31 got 
- scan-09-crowded-14  form Brufen: want "Tablet" got ""  lines=["400mg","Brufen"]
- scan-09-crowded-14  expiry(DM) Brufen: want 2028-05-31 got 
- scan-10-crowded-12  form Betaprin: want "Tablet" got ""  lines=["75mg","Betaprin"]
- scan-10-crowded-12  form Veldrin: want "Capsule" got ""  lines=["Veldrin","250 mg","20ca"]
- scan-10-crowded-12  strength Zyrtec: want "10 mg" got ""
- scan-10-crowded-12  form Zyrtec: want "Tablet" got ""  lines=["Zyrtec"]
- scan-10-crowded-12  form Nuvira: want "Tablet" got ""  lines=["Nuvira","5mg","Eechale"]
- scan-11-glare-dim  form Paracetamol: want "Tablet" got ""  lines=["Paracetamol","Ea","500 mg"]
- scan-11-glare-dim  form Lorvexa: want "Tablet" got ""  lines=["20mg","Lorvexa"]
- scan-11-glare-dim  strength Brufen: want "400 mg" got "100 mg"
- scan-11-glare-dim  form Brufen: want "Tablet" got ""  lines=["100","Brufen","mg"]
- scan-12-lowlight-noisy  form Paracetamol: want "Tablet" got ""  lines=["500","Paracetamol","mg"]
- scan-12-lowlight-noisy  form Orelix: want "Capsule" got ""  lines=["150mg","Orelix","Eachp","of","chiact"]
- scan-12-lowlight-noisy  FALSEMATCH Orelix -> Orelox
- scan-12-lowlight-noisy  strength Metformin: want "500 mg" got ""
- scan-12-lowlight-noisy  form Veldrin: want "Capsule" got ""  lines=["250mg","Veldrin"]

## Thorough mode

| image | boxes | detected | name OK | extra candidates | DataMatrix read/expected | unlinked codes | seconds |
|---|---|---|---|---|---|---|---|
| scan-01-aligned-easy | 6 | 6 | 6 | 0 | 5/5 | 1 | 16.3 |
| scan-02-aligned-mixed | 8 | 8 | 8 | 0 | 4/4 | 1 | 15.6 |
| scan-03-aligned-dense | 10 | 10 | 10 | 0 | 5/5 | 0 | 18.2 |
| scan-04-aligned-light | 7 | 7 | 7 | 0 | 5/5 | 0 | 15.1 |
| scan-05-random-6 | 6 | 6 | 6 | 0 | 3/3 | 1 | 13.9 |
| scan-06-random-8 | 8 | 7 | 6 | 0 | 2/2 | 0 | 15.3 |
| scan-07-random-8b | 8 | 8 | 8 | 0 | 7/7 | 1 | 15.2 |
| scan-08-random-10 | 10 | 10 | 10 | 0 | 6/6 | 0 | 17.3 |
| scan-09-crowded-14 | 14 | 14 | 14 | 0 | 6/6 | 2 | 19.1 |
| scan-10-crowded-12 | 12 | 12 | 12 | 0 | 9/9 | 0 | 18.7 |
| scan-11-glare-dim | 8 | 8 | 8 | 0 | 4/4 | 0 | 17.4 |
| scan-12-lowlight-noisy | 8 | 8 | 8 | 0 | 4/4 | 0 | 17.0 |

- Boxes detected: 104/105 (99%)
- Name correct (exact 99 + near 4): 103/104 (99%) of detected; exact only 99/104 (95%)
- Wrong names: 1, of which presented WITHOUT a "Check this" flag: 1
- Known drug-list names (generic/brand) matched to the right entry: 69/69 (100%)
- Invented brands falsely matched to a drug-list entry: 5/35
- Strength correct: 96/99 (97%)
- Form correct: 97/104 (93%)
- Expiry correct (barcode or printed text): 66/93 (71%)
- Batch correct: 64/93 (69%)
- GTIN correct: 52/60 (87%)
- DataMatrix codes read: 60/60 (100%); linked to a candidate: 54/60 (90%)
- Extra candidates not on any box: 0; boxes split into >1 candidate: 2
- Mean time per photo: 16.6 s (Node WASM, single thread)

### Misses and errors
- scan-01-aligned-easy  expiry(DM) Paracetamol: want 2028-08-31 got 
- scan-01-aligned-easy  expiry(DM) Zentora: want 2028-01-31 got 
- scan-02-aligned-mixed  FALSEMATCH Orelix -> Orelox
- scan-02-aligned-mixed  expiry(DM) Zyrtec: want 2026-08-31 got 
- scan-03-aligned-dense  form Gaviscon: want "Syrup" got "Suspension"  lines=["Gaviscon","150ml","B.N.K9875AEXP10/2029","Oral suspension,aniseed flavour."]
- scan-05-random-6  form Loratadine: want "Tablet" got ""  lines=["10mg","Loratadine"]
- scan-05-random-6  expiry(DM) Cetirizine: want 2027-01-31 got 
- scan-06-random-8  NAME     Zentora -> "Augmentin" (conf 0.99, check=false)
- scan-06-random-8  FALSEMATCH Zentora -> Augmentin
- scan-06-random-8  MISSED   Augmentin 625 mg
- scan-06-random-8  SPLIT    Orelix -> Orelox | Soamg
- scan-06-random-8  strength Orelix: want "150 mg" got ""
- scan-06-random-8  form Orelix: want "Capsule" got ""  lines=["Orelix","150","ee","Eachal","iveingredient150"]
- scan-06-random-8  FALSEMATCH Orelix -> Orelox
- scan-07-random-8b  expiry(DM) Orelix: want 2026-10-31 got 
- scan-07-random-8b  FALSEMATCH Orelix -> Orelox
- scan-09-crowded-14  form Nuvira: want "Tablet" got ""  lines=["5mg","Nuvira","EXP","htablet contains"]
- scan-09-crowded-14  form Cetirizine: want "Tablet" got ""  lines=["10mg","Cetirizine","EachtabletcontainsCetizine10mg.","Keepoutofreachofchildren."]
- scan-09-crowded-14  expiry(DM) Veldrin: want 2026-12-31 got 
- scan-09-crowded-14  expiry(DM) Brufen: want 2028-05-31 got 
- scan-10-crowded-12  strength Zyrtec: want "10 mg" got ""
- scan-10-crowded-12  SPLIT    Cetirizine -> Cetirizine | Keeoutfrechfie
- scan-10-crowded-12  expiry(DM) Cetirizine: want 2027-03-31 got 
- scan-11-glare-dim  strength Lorvexa: want "20 mg" got ""
- scan-11-glare-dim  form Lorvexa: want "Tablet" got ""  lines=["Lorvexa"]
- scan-12-lowlight-noisy  form Paracetamol: want "Tablet" got ""  lines=["500m","Paracetamol","Eacb","ach","mg","childonta"]
- scan-12-lowlight-noisy  FALSEMATCH Orelix -> Orelox
