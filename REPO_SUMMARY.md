# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-07-28T13:18:12.682Z.

## Overview

Full-screen Article Enhancer Agent UI that streams live gap analysis, recommendations, enhanced article drafts, and coverage verification from the enhancement API.

**Repository:** `article-enhancer-ui`  
**File count:** 40

## Features

- Full-screen streaming enhancement workspace
- Live SSE routing of blockId chunks into Gap Analysis, Recommendations, Enhanced Article, and Coverage panels
- Pipeline progress checklist with per-stage status
- Robust salvage pass so streamed data always reaches the UI
- Export / print of the enhanced output
- Prisma-backed enhancement request logging

## Tech Stack

- Next.js ^15.3.3 (App Router)
- React ^19.0.0
- Tailwind CSS v3
- TypeScript
- Prisma + PostgreSQL (Neon on Vercel)

## Infrastructure

- **DATABASE_URL:** set on Vercel when Neon is connected — do not commit real credentials

## Routes & Pages

- `/` — `app/page.tsx`
- `/access-denied` — `app/access-denied/page.tsx`

## Database Models

- `EnhancementLog`

## File Inventory

### App pages

- `app/access-denied/page.tsx`
- `app/arena-ds-tokens.css`
- `app/error.tsx`
- `app/globals.css`
- `app/layout.tsx`
- `app/not-found.tsx`
- `app/page.tsx`

### API routes

- `app/api/enhance/route.ts`

### Components

- `components/CoverageCard.tsx`
- `components/EnhancerClient.tsx`
- `components/ErrorCard.tsx`
- `components/GapAnalysisCard.tsx`
- `components/InsightTabs.tsx`
- `components/MarkdownRenderer.tsx`
- `components/ProgressChecklist.tsx`
- `components/RecommendationsCard.tsx`
- `components/ResultCard.tsx`
- `components/ResultTabs.tsx`
- `components/SectionHeader.tsx`
- `components/StageChecklist.tsx`
- `components/StatusChip.tsx`
- `components/arena-email-provider.tsx`

### Libraries

- `lib/arena-email-constants.ts`
- `lib/arena-email.ts`
- `lib/boilerplate.ts`
- `lib/normalize.ts`
- `lib/prisma.ts`
- `lib/stream.ts`
- `lib/types.ts`
- `prisma/schema.prisma`

### Config

- `.env.example`
- `middleware.ts`
- `next-env.d.ts`
- `next.config.ts`
- `package.json`
- `postcss.config.mjs`
- `tailwind.config.ts`
- `tsconfig.json`

### Other

- `README.md`
- `REPO_SUMMARY.md`

## Complete File Index

- `.env.example`
- `README.md`
- `REPO_SUMMARY.md`
- `app/access-denied/page.tsx`
- `app/api/enhance/route.ts`
- `app/arena-ds-tokens.css`
- `app/error.tsx`
- `app/globals.css`
- `app/layout.tsx`
- `app/not-found.tsx`
- `app/page.tsx`
- `components/CoverageCard.tsx`
- `components/EnhancerClient.tsx`
- `components/ErrorCard.tsx`
- `components/GapAnalysisCard.tsx`
- `components/InsightTabs.tsx`
- `components/MarkdownRenderer.tsx`
- `components/ProgressChecklist.tsx`
- `components/RecommendationsCard.tsx`
- `components/ResultCard.tsx`
- `components/ResultTabs.tsx`
- `components/SectionHeader.tsx`
- `components/StageChecklist.tsx`
- `components/StatusChip.tsx`
- `components/arena-email-provider.tsx`
- `lib/arena-email-constants.ts`
- `lib/arena-email.ts`
- `lib/boilerplate.ts`
- `lib/normalize.ts`
- `lib/prisma.ts`
- `lib/stream.ts`
- `lib/types.ts`
- `middleware.ts`
- `next-env.d.ts`
- `next.config.ts`
- `package.json`
- `postcss.config.mjs`
- `prisma/schema.prisma`
- `tailwind.config.ts`
- `tsconfig.json`

## Latest Change

- **Updated at:** 2026-07-28T13:18:12.682Z
- **Request:** Remove the option AI-powered editing
and make the whole application full-screen...
from the API, the streaming data is not shown in the UI... there is not update in the UI

Response I get 

data: {"blockId":"5188475d-759a-4ed5-a775-4b420ab36447","chunk":"[\"Cleveland Clinic and Mayo Clinic clearly outline 'when to see a dentist' criteria tied to specific symptom triggers (pain with hot/cold/sweet), making the escalation path very actionable\",\"Hopkins Medicine and Cleveland Clinic explicitly list TMD (temporomandibular disorder) and plaque buildup as causes of tooth sensitivity, which the original article omits\",\"The PMC/Frontiers clinical review articles explain the underlying 'hydrodynamic theory' mechanism of dentin hypersensitivity (fluid movement in tubules triggering nerve endings), giving readers a science-based explanation of why sensitivity happens\",\"Frontiers/PMC sources provide a clear stepwise, escalating treatment algorithm (education/behavior change → home self-care → in-office → invasive) that frames treatment choice logically by severity\",\"Multiple sources (Cleveland Clinic, PMC review) explicitly name the active desensitizing ingredients (potassium nitrate, strontium acetate, stannous fluoride, arginine/calcium carbonate, calcium sodium phosphosilicate) and explain their differing mechanisms (nerve depolarization vs. tubule occlusion)\",\"Cleveland Clinic and Mayo Clinic mention mouthwash/rinse acidity as a contributing factor and advise choosing gentler formulas, an angle absent from the original\",\"PMC and Frontiers papers cite specific prevalence statistics (10-30%, ~33% global average, ranges by country) with sourcing, giving more rigorous epidemiological grounding than the original's single 40% figure\",\"The National Dental PBRN study demonstrates real-world clinical practice patterns, showing OTC potassium nitrate toothpaste and fluoride varnish are the most commonly recommended treatments in the US, useful for setting reader expectations\",\"Frontiers article highlights that patients often don't self-report sensitivity and don't realize it's treatable, an educational/awareness angle missing from the original\",\"JADA/ADA and Mayo Clinic note practical harm-reduction dietary tactics like drinking acidic beverages with meals and delaying brushing 30-60 minutes after acidic intake, similar to but more detailed than the original's coverage\"]\n[{\"gap\":\"No explanation of the hydrodynamic theory or underlying physiological mechanism of why dentin exposure causes pain\",\"source\":\"expert_knowledge\",\"why_it_matters\":\"Explaining the 'why' behind symptoms builds patient trust and understanding, and is a staple of authoritative sources like PMC/Frontiers reviews; without it the article states causes without mechanism\"},{\"gap\":\"TMD (temporomandibular disorder) as a cause/contributor to tooth sensitivity\",\"source\":\"competitor\",\"why_it_matters\":\"Hopkins Medicine explicitly lists TMD as a cause; omitting it means the article misses a less obvious but clinically relevant trigger some readers may be experiencing\"},{\"gap\":\"Plaque buildup as a contributing cause of sensitivity\",\"source\":\"competitor\",\"why_it_matters\":\"Cleveland Clinic lists plaque buildup near roots as a trigger; this is a common, preventable cause that reinforces the oral hygiene message but is absent from the original's cause list\"},{\"gap\":\"Mouthwash/rinse acidity as a sensitivity trigger and advice to choose gentler formulas\",\"source\":\"competitor\",\"why_it_matters\":\"Cleveland Clinic and Mayo Clinic both flag acidic mouthwash as an overlooked trigger; readers using mouthwash for oral hygiene may inadvertently worsen sensitivity without this warning\"},{\"gap\":\"Specific active ingredient names and mechanisms in desensitizing toothpaste (potassium nitrate vs. stannous fluoride vs. strontium acetate vs. arginine/calcium carbonate vs. calcium sodium phosphosilicate)\",\"source\":\"competitor\",\"why_it_matters\":\"The PMC review and Frontiers article detail how different ingredients work (nerve blocking vs. tubule occlusion); the original FAQ only vaguely mentions two ingredients, missing an opportunity to help readers choose products intelligently\"},{\"gap\":\"Electric toothbrush guidance for sensitive teeth (use gently, consider pressure-sensitive models, caution for thin gingival phenotype)\",\"source\":\"expert_knowledge\",\"why_it_matters\":\"Toothbrush type and technique directly affect enamel/gum wear; the original only mentions soft-bristled manual brushes and misses growing use of electric brushes among patients\"},{\"gap\":\"Water flosser caution for sensitive teeth patients\",\"source\":\"competitor\",\"why_it_matters\":\"Frontiers article specifically warns that water flosser spray can act as a thermal/tactile trigger for DH pain; this is a specific, actionable tip absent from the original's home care section\"},{\"gap\":\"Epidemiological detail: prevalence variation by age, gender, and specific teeth most affected (canines/premolars), and global prevalence range (1.3%-92.1%, mean ~33%)\",\"source\":\"competitor\",\"why_it_matters\":\"The original cites a single flat '40% of adults' statistic without context; competitor/academic sources provide much richer epidemiological nuance (gender skew, peak age range 20-50, most affected teeth) that adds credibility and specificity\"},{\"gap\":\"Guidance on GERD/acid reflux as an intrinsic cause of enamel erosion and sensitivity\",\"source\":\"competitor\",\"why_it_matters\":\"Frontiers/PMC sources identify gastroesophageal reflux as a significant intrinsic acid source causing erosive wear and DH; the original only mentions 'stomach acids' briefly under enamel erosion without elaboration or reflux-specific advice\"},{\"gap\":\"Discussion of medications (e.g., aspirin, vitamin C tablets, iron tablets) as intrinsic acid sources contributing to tooth wear and sensitivity\",\"source\":\"expert_knowledge\",\"why_it_matters\":\"Frontiers article notes these drug-related acid exposures as an under-recognized cause; patients on these medications would benefit from awareness\"},{\"gap\":\"No mention of stress as an indirect contributor via bruxism or GERD\",\"source\":\"competitor\",\"why_it_matters\":\"The Frontiers article highlights stress as a predisposing factor via parafunctional habits and reflux; addressing stress management could be a value-add prevention tip the article currently lacks\"},{\"gap\":\"No discussion of a formal severity/quality-of-life assessment (e.g., DHEQ questionnaire) or how dentists document/track sensitivity over time\",\"source\":\"expert_knowledge\",\"why_it_matters\":\"While overly clinical for a patient guide, briefly mentioning that dentists track severity and impact on quality of life could reassure patients that their subjective symptoms are taken seriously and monitored\"},{\"gap\":\"No specific guidance distinguishing at-home vs in-office fluoride concentration (prescription high-fluoride toothpaste with specific ppm ranges)\",\"source\":\"competitor\",\"why_it_matters\":\"PMC review specifies prescription fluoride toothpaste can deliver 5,000-12,500 ppm fluoride vs standard OTC ~1,000-1,500 ppm; this concrete detail helps patients understand why a dentist-prescribed option is more potent\"},{\"gap\":\"Follow-up care cadence recommendations (e.g., check back in 1-3 months depending on severity)\",\"source\":\"competitor\",\"why_it_matters\":\"Frontiers article specifies follow-up intervals based on severity (monthly for severe, every 2-3 months for moderate); this operational detail is missing and would help set patient expectations for ongoing care\"},{\"gap\":\"No mention of dental crowns as a treatment option for severe sensitivity\",\"source\":\"expert_knowledge\",\"why_it_matters\":\"The FAQ on permanent cures mentions 'dental crowns' but the main treatment options section never explains crowns as an option, creating an inconsistency and a gap in the core treatments list\"},{\"gap\":\"No coverage of oral piercings as a cause of gum recession leading to sensitivity\",\"source\":\"competitor\",\"why_it_matters\":\"The FAQ answer on gum recession mentions oral piercings as a cause, but this risk factor isn't addressed anywhere in the main body causes or triggers sections, making it an inconsistently covered topic\"},{\"gap\":\"No explanation of resin infiltration or newer microinvasive techniques as emerging treatment options\",\"source\":\"competitor\",\"why_it_matters\":\"The PMC review references resin infiltration as a promising newer technique; while early-stage, mentioning cutting-edge options could differentiate the article as more current/comprehensive\"}]\n[\"How to Diagnose Tooth Sensitivity? — lacks detail on differential diagnosis (ruling out cavities, cracked tooth, pulpitis) and doesn't mention structured severity scales dentists may use\",\"Preventing Tooth Sensitivity: Home Remedies and Long-term Care — light on electric toothbrush guidance, water flosser caution, and specific desensitizing ingredient explanations; reads as a generic list rather than leveraging clinical nuance\",\"Common Causes of Tooth Sensitivity — omits TMD, plaque buildup, acidic mouthwash, GERD/reflux, and medication-induced acid exposure that competitor sources consistently include\",\"Tooth Sensitivity Treatment Options at Gentle Dental — doesn't explain mechanism differences between treatment types (e.g., nerve desensitizers vs. tubule occlusion) or specify prescription fluoride concentration, making it feel more like a service list than an educational treatment section\",\"Types of Tooth Sensitivity — the reversible/irreversible/primary/secondary categorization is somewhat redundant and could be tightened, while missing an explanation of the underlying hydrodynamic mechanism connecting these types\"]"}

data: {"blockId":"20386b78-e47e-4148-953b-0356f800b376","chunk":"\n\n[{\"placement\":\"What is Tooth Sensitivity?\",\"priority\":\"high\",\"rationale\":\"Explaining the 'why' behind symptoms builds patient trust and understanding, and is a staple of authoritative sources like PMC/Frontiers reviews; without it the article states causes without mechanism.\",\"recommendation\":\"Add a clear, patient-friendly explanation of the hydrodynamic theory: describe how exposed dentin tubules allow fluid movement that stimulates nerve endings in the pulp, causing sharp pain. Use a simple analogy and consider a small diagram.\"},{\"placement\":\"Common Causes of Tooth Sensitivity\",\"priority\":\"high\",\"rationale\":\"Competitor sources (Hopkins, Cleveland Clinic) consistently list TMD, plaque buildup, acidic mouthwash, GERD, and medication-induced acid exposure as causes; omitting these leaves the list incomplete and less authoritative.\",\"recommendation\":\"Expand the causes list to include: TMD/bruxism-related wear, plaque buildup near the gumline, acidic mouthwash use, GERD/acid reflux as an intrinsic acid source, and medications (aspirin, vitamin C, iron tablets) that contribute to enamel erosion.\"},{\"placement\":\"Tooth Sensitivity Treatment Options at Gentle Dental\",\"priority\":\"high\",\"rationale\":\"The FAQ mentions crowns as a permanent fix but the main treatment section never covers them, creating inconsistency; adding mechanism explanations and fluoride concentration details reframes this as an educational section rather than a service list.\",\"recommendation\":\"Add dental crowns as a treatment option for severe structural cases, explain the mechanism differences between nerve-desensitizing agents (potassium nitrate) and tubule-occluding agents (stannous fluoride, arginine/calcium carbonate, calcium sodium phosphosilicate), and specify that prescription fluoride treatments deliver 5,000-12,500 ppm versus ~1,000-1,500 ppm in OTC products.\"},{\"placement\":\"Preventing Tooth Sensitivity: Home Remedies and Long-term Care\",\"priority\":\"high\",\"rationale\":\"Frontiers article specifically warns about water flosser triggers and electric toothbrush technique; these are concrete, actionable safety tips currently missing from the home care section.\",\"recommendation\":\"Add specific guidance: recommend gentle pressure settings on electric toothbrushes (or pressure-sensor models) for patients with thin gums, and warn that water flosser spray can trigger sensitivity pain, suggesting lower pressure settings or lukewarm water.\"},{\"placement\":\"How to Diagnose Tooth Sensitivity?\",\"priority\":\"medium\",\"rationale\":\"Competitor and clinical sources emphasize differential diagnosis and severity tracking; this reassures patients that their symptoms are taken seriously and diagnosed thoroughly, not just labeled as generic sensitivity.\",\"recommendation\":\"Add a paragraph explaining that dentists rule out other causes (cavities, cracked teeth, pulpitis) during diagnosis, and briefly mention that severity/impact on quality of life may be tracked over time (e.g., via patient-reported symptom scales) to monitor treatment progress.\"},{\"placement\":\"Common Tooth Sensitivity Triggers & Prevention Strategies\",\"priority\":\"medium\",\"rationale\":\"Cleveland Clinic and Mayo Clinic flag acidic mouthwash as an overlooked trigger; readers using mouthwash for hygiene may worsen sensitivity unknowingly.\",\"recommendation\":\"Add mouthwash acidity as a trigger, advising readers to choose alcohol-free, low-acid, or fluoride-based rinses specifically formulated for sensitive teeth.\"},{\"placement\":\"Frequently Asked Questions\",\"priority\":\"medium\",\"rationale\":\"The original FAQ vaguely mentions two ingredients; naming and explaining mechanisms helps readers choose products intelligently, aligning with PMC/Frontiers detail level.\",\"recommendation\":\"Expand the 'Does desensitizing toothpaste really work?' answer to name specific active ingredients (potassium nitrate, stannous fluoride, strontium acetate, arginine/calcium carbonate, calcium sodium phosphosilicate) and briefly explain how each works (nerve depolarization vs. tubule occlusion).\"},{\"placement\":\"What is Tooth Sensitivity?\",\"priority\":\"medium\",\"rationale\":\"The single flat '40% of adults' statistic lacks nuance; richer epidemiological detail from academic sources adds credibility and specificity, and helps readers understand who is most affected.\",\"recommendation\":\"Replace or supplement the single prevalence statistic with a range (e.g., studies show prevalence between 1.3% and 92.1%, with a global average around 33%), and note that sensitivity commonly peaks between ages 20-50, and that canines and premolars are most frequently affected.\"},{\"placement\":\"Common Causes of Tooth Sensitivity\",\"priority\":\"low\",\"rationale\":\"The Frontiers article highlights stress as a predisposing factor via bruxism or reflux; this is a value-add prevention tip currently absent.\",\"recommendation\":\"Add a brief note that stress can indirectly contribute to sensitivity by increasing teeth grinding (bruxism) or exacerbating acid reflux, and suggest stress management as a complementary prevention strategy.\"},{\"placement\":\"Is tooth sensitivity a sign of gum disease? / Common Causes of Tooth Sensitivity\",\"priority\":\"low\",\"rationale\":\"The FAQ on gum recession mentions oral piercings as a cause, but this risk factor is absent from the main causes/triggers sections, creating inconsistent coverage.\",\"recommendation\":\"Add oral piercings (tongue/lip) as a risk factor for gum recession and resulting sensitivity in the main causes or triggers section, ensuring consistency with the FAQ answer.\"},{\"placement\":\"Tooth Sensitivity Treatment Options at Gentle Dental\",\"priority\":\"low\",\"rationale\":\"Frontiers/PMC sources present a stepwise escalating treatment algorithm and mention follow-up cadence; adding this structure helps set patient expectations and frames treatment choice logically.\",\"recommendation\":\"Reorganize or supplement the treatment section to show an escalating care pathway (patient education/behavior change → home self-care → in-office treatments → invasive procedures), and add follow-up cadence guidance (e.g., monthly check-ins for severe cases, every 2-3 months for moderate cases).\"},{\"placement\":\"Tooth Sensitivity Treatment Options at Gentle Dental\",\"priority\":\"low\",\"rationale\":\"The PMC review references resin infiltration as a promising newer technique; mentioning it signals that the practice offers current, cutting-edge options.\",\"recommendation\":\"Add a brief mention of resin infiltration or other microinvasive techniques as an emerging option for certain cases, positioning Gentle Dental as up-to-date with dental innovations.\"},{\"placement\":\"Types of Tooth Sensitivity\",\"priority\":\"low\",\"rationale\":\"This section currently reads as redundant categorization; tightening it and linking back to the hydrodynamic mechanism would streamline the content and reinforce the earlier explanation.\",\"recommendation\":\"Condense the reversible/irreversible and primary/secondary categories into a shorter, clearer explanation, and add a sentence connecting these types back to the hydrodynamic theory described earlier in the article.\"}]"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"\n\n[Skip to main content](https"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"://www.gentledental.com/resources/articles/tooth-sensitivity#main-content)\n\n![Tooth Sensitivity Treatment: Compl"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ete Guide to Causes, Remedies, and Solutions](https://www.gentledental.com/sites/default/files/2020-06/articles-banner.jpg"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":")\n\n## Articles\n\n# Tooth Sensitivity Treatment: Complete Guide to Causes, Remedies, and Solutions\n\nSharp, sudden tooth pain"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" can truly be a nuisance to experience and is more common than you may think. Tooth sensitivity may temporarily occur when ex"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"posed to triggers like cold air, or foods and beverages that are hot, cold, sweet, or acidic. It commonly occurs due"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" to worn tooth enamel or gum recession from issues like decay/cavities, gum disease, aggressive to"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"othbrushing, teeth grinding, or acidic diets. The good news is that there are several tooth sensitivity treatment options to stop the pain, for good. In this bl"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"og, we explore sensitive teeth causes, remedies, and solutions.\n\n![Tooth Sensitivity Treatment](https://www."}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"gentledental.com/sites/default/files/2026-06/tooth-sensitivity-treatment-causes-remedies-and-professional-solutions-inner.web"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"p)\n\n### What is Tooth Sensitivity?\n\nTooth sensitivity (dentin hypersensitivity) is a common condition, affecting approximately 40%"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" of adults. It occurs when the outer enamel layer or gum tissue is damaged, leading to exposure of the underlying dentin layer. The dentin contains ti"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ny tubules that stimulate nerves, resulting in sudden, sharp pain. For instance, sensitive teeth causes"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" include cavities (tooth decay), tooth cracks, gum recession (loss of gum tissue), broken dental restorations, te"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"eth grinding, enamel erosion (loss of tooth enamel), aggressive toothbrushing, whitening overuse, recent dental work, and a"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ging. The main tooth pain triggers include cold, hot, sweet, acidic, and air stimuli.\n\n[+ADDED]**Why does exposed dentin act"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ually hurt?** The most widely accepted explanation is called the hydrodynamic theory"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":". Think of the dentin tubules as thousands of microscopic straws running from the outer surface of the tooth"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" down to the nerve-filled pulp at its center. When enamel or gum tissue is intact, these tubules are sealed off and protected."}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" Once they become exposed, changes in temperature, pressure, or the concentration of sugars and"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" acids cause the fluid inside these tiny tubules to shift or flow. That fluid movement stimulates n"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"erve endings within the pulp, sending a quick, sharp pain signal to the brain. This is why sensitivity often feels s"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"udden and short-lived — once the triggering stimulus is removed, the fluid movement settles and the pain typ"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ically subsides.\n\nTooth sensitivity is also more common in certain gro"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ups. Research shows prevalence estimates vary widely, ranging from as low as 1.3% to"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" as high as 92.1% of the population depending on the study population and cri"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"teria used, with a global average often cited around 33%. Sensitivity tends to peak between the ages of 20 and 50, and the canines and premolars ("}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"the teeth located toward the front-to-middle of the mouth) are typically the most frequently affected"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" due to their exposure to brushing forces and gum recession.[/ADDED]\n\n### Types of Tooth Sensitivity\n\nThere are several types of too"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"th sensitivity, often categorized based on the nature, intensity, and duration of the stimuli. Here’s more details on the main types of tooth sensit"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ivity:\n\n- **Thermal (Cold/Hot):** Thermal sensitivity is the most common type, and is typically triggered by cold air, or hot or cold fo"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ods and beverages.\n- **Tactile (Touch/Brushing):** Sensitivity may result from directly touching the gums."}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" For instance, brushing, flossing, chewing, or using dental instruments may trigger tooth sensitivity.\n- **Chemical (Sweet/Acid"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"):** Chemical sensitivity may result from exposure to sugary or acidic foods and beverages (i.e., sodas, co"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ffee, energy drinks, citrus fruits, pickles, candy, desserts). Sugary and acidic foods promote bacterial accumulation, increasing the risk of d"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"entin tubule exposure from tooth decay, enamel erosion, gum recession, and other oral issues.\n- **Spontaneous (No Trigger):** In"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" some cases, tooth sensitivity can occur without being stimulated by external triggers. Spontaneous tooth sensitivity may be a sign of ser"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ious tooth nerve damage or infection.\n- **Reversible (Treatable):** Mild tooth damage or gum recession may result in reversible tooth sensit"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ivity, which tends to completely resolve shortly after stimuli are removed or minor treatments are performed. Tooth sensitivity is us"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ually sharp and short-lasting.\n- **Irreversible (Structural Damage):** When dental pulp becomes severely inflamed/inf"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ected due to issues like extensive tooth structural damage, irreversible tooth sensitivity may occur. Individuals often experience a throbbing pain that l"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ingers even after contributory stimuli are removed. Treatment is necessary to alleviate symptoms and maintain the health of the too"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"th.\n- **Primary (Lingering Pain):** This type of tooth sensitivity is typically caused by severe inflammation/infection of the dental pulp, a"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" condition known as irreversible pulpitis. Tooth sensitivity typically lingers even after stimuli are removed and requires treatment to elimin"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ate the infection.\n- **Secondary (New Exposure):** Secondary tooth sensitivity is commonly a result of newly exposed dentin, often from m"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ild gum recession or enamel wear. This type of tooth sensitivity is often sharp and quickly resolves once the stimuli are removed.\n\n[+ADDED]In short, most of these types tr"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ace back to the same underlying hydrodynamic mechanism described above — fluid movement within exposed dentin tubules tri"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ggering nerve endings in the pulp. The key differences between types typically come down to what causes the fluid movement (tem"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"perature, touch, or chemical exposure) and how much the pulp itself is inflamed, which determines whether the resulting pain is br"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ief and reversible or lingering and irreversible.[/ADDED]\n\n### Common Causes of Tooth Sensitivity\n\nThere are many possible causes of tooth s"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ensitivity, some of which are preventable, while others can be hard to avoid. Common causes of tooth sensitivity include:\n\n- **"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"Enamel Erosion:** Enamel thinning can lead to the exposure of the underlying dentin layer, which contains tiny tubules that connect to the t"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ooth’s nerves. Enamel erosion is primarily caused by acids from the diet or stomach acids.\n- **Gum Recession:** Gums"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" may erode and begin to pull away from the tooth due to issues like gum disease or natural aging. This leads to the exposure of tooth roots, which are more"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" sensitive than tooth enamel.\n- **Tooth Grinding:** Tooth grinding sensitivity may occur over time as tooth enamel wears down"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":". Teeth grinding is common during sleep and typically requires treatment with a professional custom-made mouth guard to protect teeth from"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" damage and sensitivity.\n- **Acidic Diet:** Enamel erosion often occurs from consuming acidic foods or beverages like carbonated dr"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"inks, wine, citrus fruits and juices, vinegar-based items, and starchy foods.\n- **Aggressive Brushing:** Br"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ushing too hard or using a hard-bristled toothbrush can lead to worn tooth enamel, gum recession, and other dental issues that trigger tooth sensitivity.\n- **Wh"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"itening Overuse:** Using whitening products unsupervised by a dentist or improper use can cause tooth sensitivity. This can also lead to gum damage, u"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"neven results, tooth damage, and other serious health consequences.\n- **Recent Dental Work:** Teeth may become temporarily sensitive imm"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ediately following dental treatments like fillings, crowns, and teeth whitening. Sensitivity commonly lasts from a few days to two"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" weeks, but should not progressively worsen.\n- **Decay/Tooth Cracks:** Issues like poor oral hygiene, dental trauma, and d"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ry mouth can lead to tooth decay or fractures that allow bacteria into the tooth, causing infection and tooth sensitivity."}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"\n- **Aging:** Tooth enamel naturally becomes thinner with increasing age, which increases the risk of tooth sensitivity.\n["}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"+ADDED]- **TMD/Bruxism-Related Wear:** Temporomandibular joint disorder (TMD) is often lin"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ked with clenching and grinding habits that place excess force"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" on teeth, wearing down enamel and contributing to sensitivity over time.\n- **Plaque Buildup:** A buildup of plaque near the gumline can ir"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ritate gum tissue and contribute to gum recession and enamel demineralization, both"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" of which expose the sensitive dentin layer.\n- **Acidic Mouthwash Use:** Some mouthwashes have a low"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" pH and can contribute to enamel softening or erosion with frequent use, particularly when combined with other ac"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"id exposure.\n- **GERD/Acid Reflux:** Gastroesophageal reflux disease (GERD) and other conditions that bring stomach acid into"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" the mouth can erode enamel from the inside out, similar to a highly acidic diet.\n- **Certain Medications:** Ch"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ewable aspirin, vitamin C supplements, and iron tablets can increase acid exposure or ir"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ritate oral tissues with frequent contact, contributing to enamel erosion over time.\n- **"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"Stress:** Stress can indirectly contribute to tooth sensitivity by increasing the likelihood of teeth grinding (bruxism) or worsening acid reflux sym"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ptoms. Managing stress through relaxation techniques may serve as a helpful complementary prevention strategy.\n- **Oral Piercings:**"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" Tongue or lip piercings can repeatedly rub against the gums, increasing the risk of gum recession and the"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" resulting tooth sensitivity.[/ADDED]\n\n### Common Tooth Sensitivity Triggers & Prevention Strategies\n\n| Common Tooth Sensitivity"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" Triggers | Prevention & Management Strategies |\n| --- | --- |\n| **Dietary acids** (i.e., carbonated drinks, citrus fruits/juices"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" (lemons/limes), wine, tomato-based foods, vinegar) | - Reduce consumption of acidic items<br>- Consume more water,"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" especially after acidic items<br>- Use a straw to limit tooth exposure to acids<br>- Limit snacking<br>- Wait 30 mins after consuming ac"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"idic products to brush |\n| **Temperature extremes:** Hot or cold foods/drinks or air. | - Avoid extremely hot or cold fo"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ods and beverages |\n| **Oral habits** (i.e., aggressive toothbrushing, hard-bristled toothbrushes, abrasive toothpastes, using"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" teeth as tools, teeth grinding/clenching) | - Use a soft-bristled toothbrush or an extra-soft toothbrush<br>- Br"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ush with gentle strokes/circular motions<br>- Use desensitizing toothpaste<br>- Use a custom mouthguard or night guard"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"<br>- Practice relaxation techniques to minimize stress-related teeth grinding/clenching<br>- Use desensitizing toothpaste<br>"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"- Use scissors/actual tools to open items<br>- Consult with your dental professional prior to using at-home products like teeth whitening |\n|"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" **Untreated dental issues** (i.e., tooth decay, gum recession, cracked teeth, worn/broken dental restorations) | - Maintain Regular d"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ental check-ups to identify and treat issues promptly<br>- Professional Fluoride treatments and at-home f"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"luoride use |\n[+ADDED]| **Acidic mouthwash** | - Choose alcohol-free, low-acid"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":", or fluoride-based rinses formulated specifically for sensitive teeth<br>- Ask your dentist to recommend a rinse suited to your need"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"s |[/ADDED]\n\n### How to Diagnose Tooth Sensitivity?\n\nA comprehensive examination is needed for diagnosing tooth sensitivity. A"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" thorough patient history, including your symptoms, any medical conditions, medications, and dental history, will be discussed. The dental exam for sensitive teeth also"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" typically involves dental X-rays to help diagnose underlying causes like tooth infection and cracks. Sensitivity testing will also"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" be performed to determine the health of the tooth’s dental pulp, which contains blood vessels and nerves. Common tests include applying a hot or cold subst"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ance to the tooth, percussion tests involving gentle taps to the tooth with special metal instruments, electric pulp t"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ests using a gentle electrical current, and bite tests to help identify affected teeth and possible tooth cracks.\n\n[+ADDED]An"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" important part of this process is differential diagnosis — your dentist will work to rule out other conditions that can mimic or cont"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ribute to tooth sensitivity, such as untreated cavities, cracked teeth, or pulpitis (inflammation of the tooth’s inner pulp), since"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" these often require different treatment approaches than simple dentin hypersensitivity. Your dentist may also track the severity of"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" your symptoms and their impact on your daily life over time, sometimes using patient-reported symptom scales, to"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" help monitor how well a treatment plan is working and adjust it as needed.[/ADDED]\n\n### Tooth Sensitivity Treatment Options at G"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"entle Dental\n\nGentle Dental has numerous tooth sensitivity solutions under one roof. Our team of dental specialists will devel"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"op a personalized treatment plan and preventive care plans for tooth sensitivity, including at-home sensitive teeth remedies and state-of-the-art in-"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"office procedures.\n\n[+ADDED]Treatment at Gentle Dental typically follows an escalating care pathway, starting with the least"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" invasive options and progressing as needed: beginning with patient education and behavior changes (such as adjusting brushing technique or diet), mo"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ving to home self-care products (like desensitizing toothpaste), then"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" in-office treatments (such as fluoride varnish or bonding), and finally more invasive procedures (like"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" gum grafts or root canal therapy) for severe or persistent cases. Follow-up cadence is t"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ailored to severity — patients with more severe sensitivity may benefit from monthly check-ins, while those with moderate symptoms are"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":" often monitored every two to three months to track improvement.[/ADDED]\n\nKey treatments at Gentle Dental include:\n\n- **Desensitizing ag"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"ents (fluoride varnish):** Professional fluoride application, often applied in the form of a foam or gel, is a popular tooth sens"}

data: {"blockId":"1471c258-e10d-4007-b3bb-675a064a2ab9","chunk":"itivity treatment. Fluoride helps prevent tooth decay, reduce sensitivity, and strengthen tooth enamel."}
