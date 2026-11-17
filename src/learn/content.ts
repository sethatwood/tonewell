// Learn: short, plain-language cards, each with checkable sources.
// Inline [n] markers refer to the card's own numbered sources.

export type Block = string | { list: string[] } | { note: string } | { head: string; text: string };

export interface Source {
  text: string;
  url: string;
}

export interface Card {
  id: string;
  title: string;
  short: string;
  body: Block[];
  sources: Source[];
}

export const CARDS: Card[] = [
  {
    id: 'binaural-beats',
    title: 'How binaural beats work',
    short: 'A binaural beat is a soft pulsing your brain creates when each ear hears a slightly different tone, so it isn’t in the audio itself and only works through headphones.',
    body: [
      'Play a 200 Hz tone in your left ear and a 206 Hz tone in your right, and you’ll probably hear a gentle wobble about six times a second. Neither tone contains that wobble. It appears because your brainstem compares the timing of the sound arriving at each ear, the same skill it uses to tell where a sound is coming from. The meeting point is probably the superior olivary complex, the first stop in the brain where signals from both ears come together [1][4]. H. W. Dove first described the effect in 1839, and Gerald Oster made it famous in a 1973 Scientific American article [1].',
      'The effect has limits. Classic experiments found that binaural beats come through most clearly with tones around 400–500 Hz. They grow faint as the tones approach 1000 Hz, and nobody reliably hears them above about 1500 Hz [1][2][3]. The beat rate has a ceiling too: slow differences sound like a wobble, faster ones like a slight roughness, and somewhere around 30–35 Hz the effect disappears [2][5].',
      'Headphones matter because each ear has to get only its own tone. With speakers, both ears hear both tones; the tones mix in the air and you get an ordinary “monaural” beat instead, a real pulse in loudness that one ear alone can hear [1]. Monaural beats and isochronic tones (a single tone gently switched on and off) work through speakers. In brain recordings, monaural beats usually produce a bigger response than binaural ones [4].',
      'One nice detail: a quiet bed of noise can make a binaural beat easier to hear [1].',
      { note: 'In Tonewell, the beat’s carrier sits on a harmonic of the drone (about 100–200 Hz), so it blends into the sound rather than standing apart from it. When your Mac is playing through speakers, a binaural beat is played as a monaural one.' },
    ],
    sources: [
      { text: 'Oster, G. (1973). Auditory beats in the brain. Scientific American, 229(4), 94–102.', url: 'https://doi.org/10.1038/scientificamerican1073-94' },
      { text: 'Licklider, J. C. R., Webster, J. C., & Hedlun, J. M. (1950). On the frequency limits of binaural beats. Journal of the Acoustical Society of America, 22(4), 468–473.', url: 'https://doi.org/10.1121/1.1906629' },
      { text: 'Perrott, D. R., & Nelson, M. A. (1969). Limits for the detection of binaural beats. Journal of the Acoustical Society of America, 46(6B), 1477–1481.', url: 'https://doi.org/10.1121/1.1911890' },
      { text: 'Chaieb, L., Wilpert, E. C., Reber, T. P., & Fell, J. (2015). Auditory beat stimulation and its effects on cognition and mood states. Frontiers in Psychiatry, 6, 70.', url: 'https://doi.org/10.3389/fpsyt.2015.00070' },
      { text: 'Ingendoh, R. M., Posny, E. S., & Heine, A. (2023). Binaural beats to entrain the brain? A systematic review of the effects of binaural beat stimulation on brain oscillatory activity. PLOS ONE, 18(5), e0286023.', url: 'https://doi.org/10.1371/journal.pone.0286023' },
    ],
  },
  {
    id: 'evidence',
    title: 'The evidence, honestly',
    short: 'Binaural beats are a pleasant and possibly helpful aid, but the evidence is mixed and modest, and they’re not a brain hack.',
    body: [
      'Researchers have tested binaural beats on anxiety, memory, attention and pain. The honest summary is that the results are mixed.',
      'On the hopeful side, a 2019 meta-analysis pooled 22 studies and found an average effect its authors call medium (Hedges’ g = 0.45) [1]. A 2023 meta-analysis of memory and attention found a similar average (g = 0.40), but also reported conflicting results from one study to the next [2]. Averages like these can hide a lot: most of the studies were small and used very different beat rates, durations and tasks.',
      'On the skeptical side, a 2023 review asked whether the brain actually locks on to the beat. Of 14 EEG studies, five said yes, eight said no and one was mixed, and most lacked a separate control group [3]. A careful three-experiment study of 16 Hz beats found no consistent boost to sustained attention [4]. In a small pilot with 20 children and teens with ADHD, three weeks of binaural beats did no better than a sham recording on attention tests, though families reported fewer homework problems [5]. For pain, a 2024 review rated the evidence low to very low quality [6].',
      'So where does that leave you? Binaural beats might help a little, especially if you enjoy them. They won’t override your brain or replace treatment that works for you. Think of them as one more pleasant layer in a sound you like settling into, and that’s a perfectly good reason to use them.',
    ],
    sources: [
      { text: 'Garcia-Argibay, M., Santed, M. A., & Reales, J. M. (2019). Efficacy of binaural auditory beats in cognition, anxiety, and pain perception: a meta-analysis. Psychological Research, 83(2), 357–372.', url: 'https://doi.org/10.1007/s00426-018-1066-8' },
      { text: 'Basu, S., & Banerjee, B. (2023). Potential of binaural beats intervention for improving memory and attention: insights from meta-analysis and systematic review. Psychological Research, 87(4), 951–963.', url: 'https://doi.org/10.1007/s00426-022-01706-7' },
      { text: 'Ingendoh, R. M., Posny, E. S., & Heine, A. (2023). Binaural beats to entrain the brain? PLOS ONE, 18(5), e0286023.', url: 'https://doi.org/10.1371/journal.pone.0286023' },
      { text: 'Robison, M. K., Obulasetty, M., Blais, C., Wingert, K. M., & Brewer, G. A. (2022). The effect of binaural beat stimulation on sustained attention. Psychological Research, 86(3), 808–822.', url: 'https://doi.org/10.1007/s00426-021-01524-3' },
      { text: 'Kennel, S., Taylor, A. G., Lyon, D., & Bourguignon, C. (2010). Pilot feasibility study of binaural auditory beats for reducing symptoms of inattention in children and adolescents with ADHD. Journal of Pediatric Nursing, 25(1), 3–11.', url: 'https://doi.org/10.1016/j.pedn.2008.06.010' },
      { text: 'Shamsi, F., Azadinia, F., & Shaygan, M. (2024). Does brain entrainment using binaural auditory beats affect pain perception in acute and chronic pain? A systematic review. BMC Complementary Medicine and Therapies, 24(1), 34.', url: 'https://doi.org/10.1186/s12906-024-04339-y' },
    ],
  },
  {
    id: 'brainwave-bands',
    title: 'Brainwave bands: what they are and aren’t',
    short: 'Brainwave bands are labels for the rhythms seen in EEG recordings. They aren’t dials that a sound can turn.',
    body: [
      'An EEG picks up tiny voltage changes on the scalp: the combined activity of huge numbers of brain cells firing in sync [1]. The recordings contain rhythms, and clinicians sort them into bands by speed [2]:',
      { list: [
        'Delta, below 4 Hz: dominates deep sleep.',
        'Theta, 4 to just under 8 Hz.',
        'Alpha, 8–13 Hz: clearest when you’re awake, relaxed and have your eyes closed. It fades when you pay attention or concentrate.',
        'Beta, about 14–30 Hz: typical of ordinary wakefulness.',
        'Gamma, above 30 Hz.',
      ] },
      'Many popular sources put the alpha/beta line at 13 Hz, and Tonewell’s band labels do too; different sources draw these lines slightly differently.',
      'Bands describe what shows up in a recording. Your brain runs many rhythms at once, across different networks and timescales, and they shift with what you’re doing [3]. Alpha goes with relaxed, eyes-closed rest, but that doesn’t make alpha a “relaxation setting”.',
      'A 6 Hz beat also doesn’t set your brain to 6 Hz. Your hearing system does produce a small, measurable response that follows a steady rhythm in sound [4]. But evidence for a wider shift in brain rhythms is inconsistent: in one review, only 5 of 14 EEG studies found it [5], and one careful study found no change in the matching EEG band at any of five beat rates [6].',
      'None of Tonewell’s sounds need your brain to reach a particular frequency. They’re a backdrop, not a setting.',
    ],
    sources: [
      { text: 'Nayak, C. S., & Anilkumar, A. C. Normal EEG waveforms. In StatPearls. StatPearls Publishing.', url: 'https://www.ncbi.nlm.nih.gov/books/NBK539805/' },
      { text: 'Kane, N., Acharya, J., Benickzy, S., et al. (2017). A revised glossary of terms most commonly used by clinical electroencephalographers. Clinical Neurophysiology Practice, 2, 170–185.', url: 'https://doi.org/10.1016/j.cnp.2017.07.002' },
      { text: 'Buzsáki, G., & Draguhn, A. (2004). Neuronal oscillations in cortical networks. Science, 304(5679), 1926–1929.', url: 'https://doi.org/10.1126/science.1099745' },
      { text: 'Chaieb, L., Wilpert, E. C., Reber, T. P., & Fell, J. (2015). Auditory beat stimulation and its effects on cognition and mood states. Frontiers in Psychiatry, 6, 70.', url: 'https://doi.org/10.3389/fpsyt.2015.00070' },
      { text: 'Ingendoh, R. M., Posny, E. S., & Heine, A. (2023). Binaural beats to entrain the brain? PLOS ONE, 18(5), e0286023.', url: 'https://doi.org/10.1371/journal.pone.0286023' },
      { text: 'López-Caballero, F., & Escera, C. (2017). Binaural beat: a failure to enhance EEG power and emotional arousal. Frontiers in Human Neuroscience, 11, 557.', url: 'https://doi.org/10.3389/fnhum.2017.00557' },
    ],
  },
  {
    id: 'folklore',
    title: '432 Hz, Solfeggio and the Schumann resonance',
    short: 'These ideas are popular and interesting, but none of them has good evidence that it does anything special for your body or mind.',
    body: [
      { head: '432 Hz', text: 'Some musicians believe music tuned so the note A is 432 Hz, instead of the standard 440 Hz, is better for the body [1]. The difference is small, about a third of a semitone. Pitch varied for centuries, and 440 Hz only became the international standard in 1939 [2]. In a 2019 pilot study, 33 volunteers heard the same music at each tuning on different days; heart rate came out slightly lower at 432 Hz, a result right on the edge of statistical significance, other measures showed no clear difference, and the authors called for larger trials [1]. In a later small dental trial, music at either tuning eased anxiety about equally compared with no music [3].' },
      { head: 'Solfeggio frequencies', text: 'Despite the medieval-sounding name, this set of tones (396 Hz, 528 Hz and others) is modern. It’s usually traced to Joseph Puleo and Leonard Horowitz, who promoted it in a 1999 book [4]. We found no good human studies backing their health claims.' },
      { head: 'The Schumann resonance', text: 'This one is real physics. Lightning makes the gap between the Earth’s surface and the ionosphere ring with very low-frequency electromagnetic waves; the lowest peak sits near 7.8 Hz, with more near 14, 20 and 26 Hz. W. O. Schumann predicted it in 1952 and it was first clearly measured around 1960 [5]. But it’s an electromagnetic signal, not sound, and there’s no evidence that a 7.83 Hz beat does anything just because it shares that number.' },
      'Tonewell offers A = 432 as a tuning preference, nothing more. If a tuning sounds lovely to you, enjoy it for the sound.',
    ],
    sources: [
      { text: 'Calamassi, D., & Pomponi, G. P. (2019). Music tuned to 440 Hz versus 432 Hz and the health effects: a double-blind cross-over pilot study. Explore, 15(4), 283–290. (A correction was published in Explore, 16(1), 8.)', url: 'https://doi.org/10.1016/j.explore.2019.04.001' },
      { text: 'Gribenski, F. (2023). Tuning the World: The Rise of 440 Hertz in Music, Science, and Politics, 1859–1955. University of Chicago Press.', url: 'https://press.uchicago.edu/ucp/books/book/chicago/T/bo186006661.html' },
      { text: 'Aravena, P. C., Almonacid, C., & Mancilla, M. I. (2020). Effect of music at 432 Hz and 440 Hz on dental anxiety and salivary cortisol levels in patients undergoing tooth extraction: a randomized clinical trial. Journal of Applied Oral Science, 28, e20190601.', url: 'https://doi.org/10.1590/1678-7757-2019-0601' },
      { text: 'Horowitz, L. G., & Puleo, J. (1999). Healing Codes for the Biological Apocalypse. Tetrahedron Publishing.', url: 'https://openlibrary.org/works/OL22112372W' },
      { text: 'Price, C. (2016). ELF electromagnetic waves from lightning: the Schumann resonances. Atmosphere, 7(9), 116.', url: 'https://doi.org/10.3390/atmos7090116' },
    ],
  },
  {
    id: 'wandering-mind',
    title: 'Meditation and the wandering mind',
    short: 'Minds wander all the time, and that’s normal. Meditation is less about stopping thoughts than about noticing you’ve drifted and coming back.',
    body: [
      'In 2010, Harvard researchers used a smartphone app to check in with about 2,250 volunteers at random moments. People were thinking about something other than what they were doing in about 47% of samples, and they tended to be less happy when their minds had wandered [1][2]. The timing in the data hinted that the wandering usually came before the dip in mood, but this was an observational study, not an experiment.',
      'Brain researchers had meanwhile noticed a set of regions that stays busy when we’re not focused on an outside task and quiets down when we are. Marcus Raichle and colleagues called it a “default mode” of brain function [3]. Later work tied this default mode network to self-focused thinking and mind-wandering [4][5].',
      'When a Yale team scanned experienced meditators, core default-mode regions were relatively quieter during meditation than in newcomers, and regions linked with self-monitoring were more tightly connected [4]. A larger follow-up found a similar pattern [5]. These studies compare groups at one point in time, so they can’t show that meditation caused the differences, and they looked at other practices, not TM.',
      'Another study split meditation into a simple loop: the mind wanders, you notice, you shift back, you stay a while. Different brain networks were active at different steps [6]. That loop is the practice. And mind-wandering isn’t the enemy: it’s linked to planning and creativity as well as to mistakes [7].',
      'So if your attention drifts fifty times in one sitting, nothing has gone wrong. Each time you notice and come back, you’ve done the thing.',
    ],
    sources: [
      { text: 'Killingsworth, M. A., & Gilbert, D. T. (2010). A wandering mind is an unhappy mind. Science, 330(6006), 932.', url: 'https://doi.org/10.1126/science.1192439' },
      { text: 'Bradt, S. (2010, November 11). Wandering mind not a happy mind. Harvard Gazette.', url: 'https://news.harvard.edu/gazette/story/2010/11/wandering-mind-not-a-happy-mind/' },
      { text: 'Raichle, M. E., MacLeod, A. M., Snyder, A. Z., Powers, W. J., Gusnard, D. A., & Shulman, G. L. (2001). A default mode of brain function. PNAS, 98(2), 676–682.', url: 'https://doi.org/10.1073/pnas.98.2.676' },
      { text: 'Brewer, J. A., Worhunsky, P. D., Gray, J. R., Tang, Y. Y., Weber, J., & Kober, H. (2011). Meditation experience is associated with differences in default mode network activity and connectivity. PNAS, 108(50), 20254–20259.', url: 'https://doi.org/10.1073/pnas.1112029108' },
      { text: 'Garrison, K. A., Zeffiro, T. A., Scheinost, D., Constable, R. T., & Brewer, J. A. (2015). Meditation leads to reduced default mode network activity beyond an active task. Cognitive, Affective, & Behavioral Neuroscience, 15(3), 712–720.', url: 'https://doi.org/10.3758/s13415-015-0358-3' },
      { text: 'Hasenkamp, W., Wilson-Mendenhall, C. D., Duncan, E., & Barsalou, L. W. (2012). Mind wandering and attention during focused meditation. NeuroImage, 59(1), 750–760.', url: 'https://doi.org/10.1016/j.neuroimage.2011.07.008' },
      { text: 'Smallwood, J., & Schooler, J. W. (2015). The science of mind wandering: empirically navigating the stream of consciousness. Annual Review of Psychology, 66, 487–518.', url: 'https://doi.org/10.1146/annurev-psych-010814-015331' },
    ],
  },
  {
    id: 'relaxation-response',
    title: 'The relaxation response and mantra meditation',
    short: 'Gently repeating a word or sound and letting stray thoughts go is a well-studied way to settle. The evidence for TM specifically is real but modest, and much of it comes from researchers tied to the TM organization.',
    body: [
      'In 1970, a study in Science measured people practicing Transcendental Meditation and found that oxygen use and heart rate fell during meditation [1]. Harvard physician Herbert Benson, who also studied TM practitioners, came to see such changes as a general “relaxation response”, the body’s counterpart to fight-or-flight, and concluded that many techniques could produce it [2][3][4]. He boiled it down to two steps: repeat a sound, word, phrase, prayer or movement, and when other thoughts intrude, passively set them aside and return to the repetition [3].',
      'How strong is the evidence? A 2007 review for the US Agency for Healthcare Research and Quality sifted 813 meditation studies, mostly of poor quality. Pooled results suggested that TM and some other practices lowered blood pressure, but the authors said firm conclusions couldn’t be drawn [5]. A 2014 Johns Hopkins meta-analysis counted only trials with active comparison groups. It found moderate evidence that mindfulness programs ease anxiety, depression and pain, but only low or insufficient evidence for mantra programs, TM included, partly because so few mantra trials qualified [6]. In 2013 the American Heart Association rated TM “Class IIB, Level of Evidence B” for lowering blood pressure: better than the other meditation techniques it reviewed, though it described behavioral approaches overall as having “modest, mixed, or no consistent evidence” [7].',
      'One more caveat: a 2004 independent review of TM blood-pressure trials found that none of the trials it could evaluate was run by authors free of ties to the TM organization [8]. That doesn’t make the results wrong. It’s a reason to welcome more independent research.',
      { note: 'Tonewell isn’t affiliated with or endorsed by any meditation organization, and it doesn’t teach a technique. Transcendental Meditation and TM are trademarks of their owners.' },
    ],
    sources: [
      { text: 'Wallace, R. K. (1970). Physiological effects of transcendental meditation. Science, 167(3926), 1751–1754.', url: 'https://doi.org/10.1126/science.167.3926.1751' },
      { text: 'Benson, H., Beary, J. F., & Carol, M. P. (1974). The relaxation response. Psychiatry, 37(1), 37–46.', url: 'https://doi.org/10.1080/00332747.1974.11023785' },
      { text: 'Benson-Henry Institute for Mind Body Medicine (2022). The passing of Herbert Benson, MD.', url: 'https://bensonhenryinstitute.org/the-passing-of-herbert-benson-md/' },
      { text: 'Tricycle (2022, February 24). Dr. Herbert Benson, who brought meditation to the medical mainstream, dies at 86.', url: 'https://tricycle.org/article/herbert-benson-dies/' },
      { text: 'Ospina, M. B., Bond, K., Karkhaneh, M., et al. (2007). Meditation practices for health: state of the research. Evidence Report/Technology Assessment No. 155. AHRQ.', url: 'https://pubmed.ncbi.nlm.nih.gov/17764203/' },
      { text: 'Goyal, M., Singh, S., Sibinga, E. M., et al. (2014). Meditation programs for psychological stress and well-being: a systematic review and meta-analysis. JAMA Internal Medicine, 174(3), 357–368.', url: 'https://doi.org/10.1001/jamainternmed.2013.13018' },
      { text: 'Brook, R. D., Appel, L. J., Rubenfire, M., et al. (2013). Beyond medications and diet: alternative approaches to lowering blood pressure. A scientific statement from the American Heart Association. Hypertension, 61(6), 1360–1383.', url: 'https://doi.org/10.1161/HYP.0b013e318293645f' },
      { text: 'Canter, P. H., & Ernst, E. (2004). Insufficient evidence to conclude whether or not Transcendental Meditation decreases blood pressure. Journal of Hypertension, 22(11), 2049–2054.', url: 'https://doi.org/10.1097/00004872-200411000-00002' },
    ],
  },
  {
    id: 'adhd',
    title: 'ADHD and meditation: why sound can help',
    short: 'Meditation is a reasonable thing to try with ADHD, and the research is promising but early. Some restless minds also settle better with gentle sound than with silence.',
    body: [
      'If silence makes your mind louder, there’s a plausible reason. The “moderate brain arousal” model proposes that ADHD involves lower background dopamine activity, so a too-quiet setting leaves the brain under-aroused, which people often make up for by moving and fidgeting. In this model, moderate stimulation helps performance while too little or too much hurts it [1]. It’s a theory, but lab studies of background noise lend it some support (see Sound for focus).',
      'What about meditation itself? An early UCLA study taught mindfulness to 24 adults and 8 teens with ADHD. Most finished, liked it and reported fewer symptoms, though there was no comparison group [2]. A 2010 Cochrane review found only four small trials, all at high risk of bias, and couldn’t reach a conclusion; two of the four used mantra meditation [3]. Later reviews are more encouraging, linking mindfulness programs to medium-sized drops in inattention and hyperactivity [4]. But a 2021 review found the benefit looked medium-to-large against waiting lists and small or negligible against active alternatives, and framed mindfulness as a complement to other treatment, not a replacement [5]. A large 2025 review of reviews in The BMJ found large effects for mindfulness in adults with ADHD, but rated the evidence low-certainty [6].',
      'The honest summary: it’s worth trying, it’s not a substitute for care, and mantra meditation for ADHD is barely studied.',
      'Some gentle tips:',
      { list: [
        'Start short. A few minutes counts.',
        'Expect wandering, lots of it. Noticing is the practice, so come back without scolding yourself.',
        'Let the sound be somewhere soft for restless attention to land, not something to study.',
        'A messy session is still a session.',
        'Keep the volume low.',
      ] },
      { note: 'General information, not medical advice.' },
    ],
    sources: [
      { text: 'Sikström, S., & Söderlund, G. (2007). Stimulus-dependent dopamine release in attention-deficit/hyperactivity disorder. Psychological Review, 114(4), 1047–1075.', url: 'https://doi.org/10.1037/0033-295X.114.4.1047' },
      { text: 'Zylowska, L., Ackerman, D. L., Yang, M. H., et al. (2008). Mindfulness meditation training in adults and adolescents with ADHD: a feasibility study. Journal of Attention Disorders, 11(6), 737–746.', url: 'https://doi.org/10.1177/1087054707308502' },
      { text: 'Krisanaprakornkit, T., Ngamjarus, C., Witoonchart, C., & Piyavhatkul, N. (2010). Meditation therapies for attention-deficit/hyperactivity disorder (ADHD). Cochrane Database of Systematic Reviews, CD006507.', url: 'https://doi.org/10.1002/14651858.CD006507.pub2' },
      { text: 'Cairncross, M., & Miller, C. J. (2020). The effectiveness of mindfulness-based therapies for ADHD: a meta-analytic review. Journal of Attention Disorders, 24(5), 627–643.', url: 'https://doi.org/10.1177/1087054715625301' },
      { text: 'Oliva, F., Malandrone, F., di Girolamo, G., et al. (2021). The efficacy of mindfulness-based interventions in ADHD beyond core symptoms: a systematic review, meta-analysis, and meta-regression. Journal of Affective Disorders, 292, 475–486.', url: 'https://doi.org/10.1016/j.jad.2021.05.068' },
      { text: 'Gosling, C. J., Garcia-Argibay, M., De Prisco, M., et al. (2025). Benefits and harms of ADHD interventions: umbrella review and platform for shared decision making. BMJ, 391, e085875.', url: 'https://doi.org/10.1136/bmj-2025-085875' },
    ],
  },
  {
    id: 'focus-sound',
    title: 'Sound for focus',
    short: 'For many people with ADHD a soft, steady sound bed helps a little; for many others it hurts a little. Words and choppy sounds are the hardest to tune out.',
    body: [
      'Noise usually counts as a distraction, but “stochastic resonance”, where a moderate amount of random noise helps a system pick up weak signals, suggests a twist. Swedish researchers proposed that ADHD brains need more of this background noise to work at their best [1]. In their 2007 study, white noise helped children with ADHD on memory tasks and hurt children without ADHD [2]. A 2016 study found white noise cut missed responses in children with ADHD, and that the benefit varied from child to child [3].',
      'The best summary so far is a 2024 meta-analysis of 13 studies with 335 young people who had ADHD or ADHD symptoms. White and pink noise gave a small but consistent boost on lab attention tasks, smaller than medication. In people without ADHD, noise slightly hurt performance. No studies of brown noise turned up. The studies used only minutes of exposure, and the authors urge caution about volume, because long exposure even at moderate levels can harm hearing [4].',
      'What kind of sound? Background speech is a classic focus thief: even speech you’re ignoring disrupts short-term memory [5][6], and in one trial music with lyrics hurt attention [7]. Lab work points to “changing state”: sound broken into distinct, shifting chunks such as syllables or notes disrupts memory, while steady sound does much less [8][9]. Smoothly gliding tones didn’t disrupt, but the same glides chopped up by silences did [10].',
      'Our inference, not yet tested: a continuous, slowly morphing, wordless sound bed should be easier to tune out than songs or podcasts. That’s why Tonewell’s drone glides between notes instead of stepping, and why Focus presets leave out bells and the beat. Keep it quiet, and if it isn’t helping you, turn it off.',
      { note: 'Brown noise is offered because many people like it, not because research shows it works better.' },
    ],
    sources: [
      { text: 'Sikström, S., & Söderlund, G. (2007). Stimulus-dependent dopamine release in attention-deficit/hyperactivity disorder. Psychological Review, 114(4), 1047–1075.', url: 'https://doi.org/10.1037/0033-295X.114.4.1047' },
      { text: 'Söderlund, G., Sikström, S., & Smart, A. (2007). Listen to the noise: noise is beneficial for cognitive performance in ADHD. Journal of Child Psychology and Psychiatry, 48(8), 840–847.', url: 'https://doi.org/10.1111/j.1469-7610.2007.01749.x' },
      { text: 'Baijot, S., Slama, H., Söderlund, G., et al. (2016). Neuropsychological and neurophysiological benefits from white noise in children with and without ADHD. Behavioral and Brain Functions, 12(1), 11.', url: 'https://doi.org/10.1186/s12993-016-0095-y' },
      { text: 'Nigg, J. T., Bruton, A., Kozlowski, M. B., Johnstone, J. M., & Karalunas, S. L. (2024). Systematic review and meta-analysis: do white noise or pink noise help with task performance in youth with ADHD or with elevated attention problems? JAACAP, 63(8), 778–788.', url: 'https://doi.org/10.1016/j.jaac.2023.12.014' },
      { text: 'Salamé, P., & Baddeley, A. (1982). Disruption of short-term memory by unattended speech. Journal of Verbal Learning and Verbal Behavior, 21(2), 150–164.', url: 'https://doi.org/10.1016/S0022-5371(82)90521-7' },
      { text: 'Banbury, S. P., Macken, W. J., Tremblay, S., & Jones, D. M. (2001). Auditory distraction and short-term memory: phenomena and practical implications. Human Factors, 43(1), 12–29.', url: 'https://doi.org/10.1518/001872001775992462' },
      { text: 'Shih, Y. N., Huang, R. H., & Chiang, H. Y. (2012). Background music: effects on attention performance. Work, 42(4), 573–578.', url: 'https://doi.org/10.3233/WOR-2012-1410' },
      { text: 'Jones, D., Madden, C., & Miles, C. (1992). Privileged access by irrelevant speech to short-term memory: the role of changing state. Quarterly Journal of Experimental Psychology A, 44(4), 645–669.', url: 'https://doi.org/10.1080/14640749208401304' },
      { text: 'Jones, D., & Morris, N. (1992). Irrelevant speech and serial recall: implications for theories of attention and working memory. Scandinavian Journal of Psychology, 33(3), 212–229.', url: 'https://doi.org/10.1111/j.1467-9450.1992.tb00911.x' },
      { text: 'Jones, D. M., Macken, W. J., & Murray, A. C. (1993). Disruption of visual short-term memory by changing-state auditory stimuli: the role of segmentation. Memory & Cognition, 21(3), 318–328.', url: 'https://doi.org/10.3758/BF03208264' },
    ],
  },
  {
    id: 'safety',
    title: 'Safety',
    short: 'Tonewell is built to be gentle, but a few sensible precautions apply: flashing light, driving, volume, and what to do if things feel like too much.',
    body: [
      { head: 'Flashing light', text: 'The main safety concern with visuals is flicker. About 3% of people with epilepsy have photosensitive epilepsy; for them, lights flashing about 3–30 times a second are the most common seizure trigger, though it varies from person to person [1]. Web accessibility guidelines say nothing should flash more than three times in any one second [2], and an Epilepsy Foundation expert panel advises designers to avoid bright flashing around 10–20 Hz and high-contrast stripes [3]. Tonewell’s visuals are optional, and their brightness is never allowed to change faster than three times a second. If you have epilepsy or have ever had a seizure, talk to your doctor before using the visuals or any rhythmic audio.' },
      { head: 'Driving and machinery', text: 'Don’t use Tonewell while driving, cycling or doing anything else that needs your full alertness. It’s designed to help you settle, and headphones mask the sounds around you.' },
      { head: 'Volume', text: 'Quiet works. The World Health Organization’s safe-listening guidance puts a weekly safe dose at 80 dB for up to 40 hours for adults, and 75 dB for children; at 90 dB the safe time drops to about 4 hours a week [4][5]. A simple rule of thumb from the WHO is to keep your device volume at no more than 60% of maximum [4]. Tonewell raises volume slowly, at most 12 dB a second, so nothing jumps.' },
      { head: 'If it’s too much', text: 'If you feel overwhelmed, dizzy or uneasy, press Wind down (or Esc). Everything fades to a low, warm hum and stays there until you choose Resume or End.' },
      { note: 'General information, not medical advice.' },
    ],
    sources: [
      { text: 'Epilepsy Society (UK). Photosensitive epilepsy.', url: 'https://epilepsysociety.org.uk/about-epilepsy/epileptic-seizures/seizure-triggers/photosensitive-epilepsy' },
      { text: 'W3C Web Accessibility Initiative. Understanding Success Criterion 2.3.1: Three Flashes or Below Threshold.', url: 'https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html' },
      { text: 'Fisher, R. S., Wilkins, A., Takahashi, Y., et al. (2026). Visually-provoked seizures: Consensus of the Epilepsy Foundation Working Group. Epilepsia, 67(2), 565–581.', url: 'https://doi.org/10.1111/epi.18702' },
      { text: 'World Health Organization (2026). Deafness and hearing loss: Safe listening.', url: 'https://www.who.int/news-room/questions-and-answers/item/deafness-and-hearing-loss-safe-listening' },
      { text: 'World Health Organization & International Telecommunication Union (2019). Safe listening devices and systems: a WHO-ITU standard.', url: 'https://www.who.int/publications/i/item/9789241515276' },
    ],
  },
];

export const GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: 'Beats', ids: ['binaural-beats', 'evidence', 'brainwave-bands', 'folklore'] },
  { label: 'Meditation', ids: ['wandering-mind', 'relaxation-response', 'adhd'] },
  { label: 'Focus', ids: ['focus-sound'] },
  { label: 'Care', ids: ['safety'] },
];
