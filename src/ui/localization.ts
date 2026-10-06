// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sitr contributors
export type Language = 'en' | 'ar';
let language: Language = 'en';

// Source text is the key: controls, option values, and DOM structure stay unchanged.
export const ARABIC: Readonly<Record<string, string>> = {
  'Sitr': 'ستر',
  'Sitr settings': 'إعدادات ستر',
  'Private media protection': 'حماية الصور والفيديو بخصوصية',
  'Changes apply across websites': 'تُطبّق التغييرات على جميع المواقع',
  'Theme': 'المظهر', 'Language': 'اللغة', 'System': 'النظام', 'Light': 'فاتح', 'Dark': 'داكن',
  'Settings sections': 'أقسام الإعدادات', 'Coverage settings': 'إعدادات التغطية',
  'Coverage appearance': 'مظهر التغطية', 'Appearance settings': 'إعدادات المظهر',
  'Enable protection': 'تفعيل الحماية',
  'Coverage': 'التغطية', 'Detection': 'الكشف', 'Performance': 'الأداء', 'Diagnostics': 'التشخيص', 'Websites': 'المواقع',
  'All processing stays on your device.': 'تتم معالجة جميع البيانات على جهازك.',
  'Loading protection…': 'جارٍ تحميل الحماية…', 'Checking settings…': 'جارٍ التحقق من الإعدادات…',
  'Protection is on': 'الحماية مفعّلة', 'Protection is paused': 'الحماية متوقفة',
  'Paused on this site': 'الحماية متوقفة على هذا الموقع',
  'No people selected': 'لم تُحدّد أشخاصًا', 'No media selected': 'لم تُحدّد نوع المحتوى',
  'Turn on to resume across websites.': 'فعّل الحماية لاستئنافها على جميع المواقع.',
  'Enabled on other websites.': 'الحماية مفعّلة على المواقع الأخرى.',
  'Choose who to cover below.': 'اختر الأشخاص الذين تريد تغطيتهم أدناه.',
  'Turn on Images or Videos below.': 'فعّل الصور أو الفيديو أدناه.',
  'Your choices apply across websites.': 'تُطبّق اختياراتك على جميع المواقع.',
  'Cover people': 'تغطية الأشخاص', 'Female appearance': 'المظهر الأنثوي', 'Male appearance': 'المظهر الذكوري',
  'Everyone': 'الجميع', 'No one': 'لا أحد', 'Apply to': 'يُطبّق على', 'Images': 'الصور', 'Videos': 'الفيديو',
  'Image appearance': 'مظهر الصور', 'Video appearance': 'مظهر الفيديو',
  'Image protection is off. Turn on Images above to apply these settings.': 'حماية الصور متوقفة. فعّل الصور أعلاه لتطبيق هذه الإعدادات.',
  'Video protection is off. Turn on Videos above to apply these settings.': 'حماية الفيديو متوقفة. فعّل الفيديو أعلاه لتطبيق هذه الإعدادات.',
  'Cover area': 'منطقة التغطية', 'Selected skin and hair': 'البشرة والشعر المحدّدان',
  'Whole body · separate face effect': 'الجسم كاملًا · تأثير منفصل للوجه',
  'Whole body · same effect on face': 'الجسم والوجه · التأثير نفسه',
  'Body skin': 'بشرة الجسم', 'Hair': 'الشعر', 'Face effect': 'تأثير الوجه', 'Body effect': 'تأثير الجسم',
  'Show face': 'إظهار الوجه', 'Black': 'أسود', 'Blur': 'تمويه', 'Checkerboard blur': 'تمويه مربّع',
  'Selected skin and hair use a black mask.': 'تُغطّى البشرة والشعر المحدّدان بالأسود.',
  'Skin exposure rules': 'قواعد نسبة البشرة المكشوفة',
  'Applies to your selected people. Body skin is measured as a share of the detected person; face skin is excluded.': 'تُطبّق على الأشخاص المحدّدين. تُقاس بشرة الجسم كنسبة من مساحة الشخص المكتشف، ولا تُحتسب بشرة الوجه.',
  'Black high-skin bodies': 'حجب الأجسام ذات نسبة البشرة المرتفعة بالأسود',
  'Skin above (%)': 'نسبة البشرة أكبر من (%)',
  'Include face in blackout': 'حجب الوجه أيضًا بالأسود',
  'Matched faces stay visible when this is off. This rule uses black, regardless of the body effect.': 'تبقى الوجوه المرتبطة بالأشخاص ظاهرة عند إيقاف هذا الخيار. تستخدم هذه القاعدة اللون الأسود مهما كان تأثير الجسم.',
  'Black image for high-skin groups': 'حجب الصورة عند ارتفاع نسبة البشرة لدى مجموعة',
  'Skin at least (%)': 'نسبة البشرة لا تقل عن (%)',
  'More than (people)': 'العدد أكبر من (أشخاص)',
  'Black the whole image when more than this many selected people reach the skin percentage.': 'تُحجب الصورة كاملة عندما يتجاوز عدد الأشخاص المحدّدين الذين يبلغون نسبة البشرة هذا العدد.',
  'Enter a value within the shown limits.': 'أدخل قيمة ضمن الحدود المحدّدة.',
  'A face stays covered if it cannot be matched to one person.': 'يبقى الوجه مغطّى إذا تعذّر ربطه بشخص واحد.',
  'Adjust body effect': 'ضبط تأثير الجسم', 'Adjust face effect': 'ضبط تأثير الوجه', 'Adjust video effect': 'ضبط تأثير الفيديو',
  'Body effect strength': 'قوة تأثير الجسم', 'Face effect strength': 'قوة تأثير الوجه', 'Effect strength': 'قوة التأثير',
  'Grayscale effect': 'تأثير بتدرّج رمادي', 'Grayscale face effect': 'تأثير الوجه بتدرّج رمادي', 'Effect': 'التأثير',
  'Videos cover the whole person, including the face.': 'يُغطّى الشخص كاملًا في الفيديو، بما في ذلك الوجه.',
  'Models and detection': 'النماذج والكشف',
  'Estimate male/female appearance automatically': 'تقدير المظهر الذكوري أو الأنثوي تلقائيًا',
  'Gender model': 'نموذج تقدير المظهر', 'Face (current)': 'الوجه (الحالي)',
  'Whole body · Paddle': 'الجسم كاملًا · Paddle', 'Whole body · Intel': 'الجسم كاملًا · Intel',
  'Face, then Paddle if unavailable': 'الوجه، ثم Paddle عند التعذّر', 'Face, then Intel if unavailable': 'الوجه، ثم Intel عند التعذّر',
  'Unclassified people': 'الأشخاص غير المصنّفين', 'Censor': 'تغطية', 'Show': 'إظهار',
  'Whole-body gender uses the person crop to estimate appearance. Uncertain estimates stay unclassified.': 'يستخدم نموذج الجسم صورة الشخص المقتطعة لتقدير مظهره. تبقى التقديرات غير المؤكدة دون تصنيف.',
  'Only censor images when': 'تغطية الصور فقط عند',
  'No detection required (current behavior)': 'دون اشتراط الكشف (السلوك الحالي)',
  'A face is detected': 'اكتشاف وجه', 'A YOLO person is detected': 'اكتشاف شخص بواسطة YOLO',
  'A face or YOLO person is detected': 'اكتشاف وجه أو شخص بواسطة YOLO',
  'Both a face and YOLO person are detected': 'اكتشاف وجه وشخص بواسطة YOLO معًا',
  'This also controls MediaPipe-only masks. Requiring a detection can leave a person uncovered when a model misses them.': 'يتحكّم هذا أيضًا في أقنعة MediaPipe وحدها. قد يترك اشتراط الكشف شخصًا دون تغطية إذا لم يكتشفه النموذج.',
  'Image mask expansion': 'توسيع قناع الصورة', 'Video mask expansion': 'توسيع قناع الفيديو',
  'Whole-body gender uses person boxes without the face gender classifier. Uncertain estimates stay unclassified.': 'يستخدم نموذج الجسم مربّعات الأشخاص دون مصنّف مظهر الوجه. تبقى التقديرات غير المؤكدة دون تصنيف.',
  'Playback': 'التشغيل', 'Smooth': 'سلس', 'Strict': 'صارم', 'Person detector': 'كاشف الأشخاص',
  'YOLO silhouette': 'حدود الجسم بواسطة YOLO', 'Fast person boxes': 'مربّعات أشخاص سريعة',
  'Fast boxes use a 256 × 256 detection model. They run faster but cover rectangular areas around people.': 'تستخدم المربّعات السريعة نموذج كشف بدقة ٢٥٦ × ٢٥٦. تعمل أسرع، لكنها تغطّي مناطق مستطيلة حول الأشخاص.',
  "Video covers selected people's full silhouettes, including faces. Fast motion can still outrun a mask.": 'يُغطّى جسم الشخص المحدّد كاملًا في الفيديو، بما في ذلك الوجه. قد تسبق الحركة السريعة القناع.',
  'Video covers selected people with expanded boxes, including faces. Fast motion can still outrun a box.': 'يُغطّى الأشخاص المحدّدون بمربّعات موسّعة، بما في ذلك الوجوه. قد تسبق الحركة السريعة المربّع.',
  'Expansion adds a margin in analysis pixels. Larger values cover more nearby area.': 'يضيف التوسيع هامشًا بوحدات بكسل التحليل. تغطّي القيم الأكبر مساحة إضافية حول الشخص.',
  'Performance and resolution': 'الأداء والدقة', 'Performance preset': 'إعداد الأداء',
  'Balanced': 'متوازن', 'Quality': 'جودة', 'ONNX CPU threads': 'خيوط المعالج لـ ONNX', 'Auto': 'تلقائي',
  'Higher thread counts can be slower when CPU and GPU work compete. Changing this restarts the analysis engine.': 'قد تؤدي زيادة الخيوط إلى بطء عند تنافس المعالجين المركزي والرسومي. يعيد تغيير هذا الإعداد تشغيل محرك التحليل.',
  'Model resolution': 'دقة النماذج',
  'Higher resolution may find smaller details but takes longer. Auto follows the performance preset. Changes reanalyze current media.': 'قد تكشف الدقة الأعلى تفاصيل أصغر، لكنها تستغرق وقتًا أطول. يتبع الوضع التلقائي إعداد الأداء. يُعاد تحليل المحتوى الحالي عند التغيير.',
  'YOLO image input': 'دخل YOLO للصور', 'YOLO video input': 'دخل YOLO للفيديو', 'YuNet input': 'دخل YuNet', 'Face capture': 'التقاط الوجه',
  'Face capture sets the source detail for YuNet and FastFace crops. MediaPipe semantic runs for every image mode at its packaged 256×256 input; FastFace stays at 128×128. Their model input sizes cannot be changed with these files.': 'يحدّد التقاط الوجه مستوى تفاصيل المصدر لـ YuNet وصور FastFace المقتطعة. يعمل MediaPipe في جميع أوضاع الصور بدقة ٢٥٦×٢٥٦، ويبقى FastFace بدقة ١٢٨×١٢٨. لا يمكن تغيير حجم دخل هذين النموذجين باستخدام هذه الملفات.',
  'Face/person matching': 'ربط الوجه بالشخص', 'Overlap score (stricter)': 'درجة التداخل (أكثر صرامة)',
  'Face-box center point': 'مركز مربّع الوجه',
  'Show AI debug outlines, face boxes, and gender estimates': 'إظهار حدود تشخيص النماذج ومربّعات الوجوه وتقديرات المظهر',
  'Face association diagnostics': 'تشخيص ربط الوجوه', 'Advanced AI thresholds': 'عتبات النماذج المتقدّمة',
  'Lower confidence cutoffs detect more candidates but can increase false detections and incorrect labels. Changes reanalyze current media.': 'تكشف عتبات الثقة المنخفضة مرشّحين أكثر، لكنها قد تزيد الاكتشافات الخاطئة والتصنيفات غير الصحيحة. يُعاد تحليل المحتوى الحالي عند التغيير.',
  'YOLO person confidence': 'ثقة YOLO في كشف الشخص', 'Face detection confidence': 'ثقة كشف الوجه',
  'Minimum detected face width (px)': 'أقل عرض للوجه المكتشف (بكسل)', 'Gender estimate confidence': 'ثقة تقدير المظهر',
  'Small-face boundary (px)': 'حدّ الوجه الصغير (بكسل)', 'Small-face confidence': 'ثقة الوجه الصغير',
  'Face/person mask coverage': 'تغطية قناع الشخص للوجه',
  'Minimum share of the face center covered by one YOLO person mask. Higher values require a fuller match. Body-only gender and Fast person boxes use their own matching.': 'أقل نسبة من مركز الوجه يغطيها قناع شخص واحد من YOLO. تتطلب القيم الأعلى تطابقًا أكبر. يستخدم نموذج الجسم والمربّعات السريعة آلية الربط الخاصة بهما.',
  'Association winner margin': 'هامش ترجيح الربط', 'Center-point mask confidence': 'ثقة القناع عند المركز',
  'Label person on page': 'تصنيف شخص على الصفحة', 'Retry engine': 'إعادة تشغيل المحرك',
  'Labels last only for the current media session. Click the person after choosing this action.': 'تستمر التصنيفات لجلسة المحتوى الحالية فقط. انقر على الشخص بعد اختيار هذا الإجراء.',
  'Websites to skip': 'مواقع تُستثنى من الحماية',
  'Protection is paused on these websites, including their subdomains and embedded media.': 'تتوقف الحماية على هذه المواقع، بما فيها نطاقاتها الفرعية والمحتوى المضمّن.',
  'Domains or URLs': 'النطاقات أو الروابط',
  'Separate entries with commas or new lines. URLs are saved as domains.': 'افصل الإدخالات بفواصل أو أسطر جديدة. تُحفظ الروابط كنطاقات.',
  'Save websites': 'حفظ المواقع', 'This site': 'هذا الموقع', 'Checking website…': 'جارٍ التحقق من الموقع…',
  'Pause on this site': 'إيقاف الحماية هنا', 'Resume on this site': 'استئناف الحماية هنا',
  'Checking this page…': 'جارٍ التحقق من الصفحة…', 'Manage site exceptions': 'إدارة استثناءات المواقع',
  'Site limit reached. Manage websites': 'بلغت حدّ المواقع. إدارة المواقع',
  'Paused by a parent-domain exception. Manage websites to change it.': 'الحماية متوقفة بسبب استثناء النطاق الرئيسي. غيّر ذلك من إدارة المواقع.',
  'Protection is paused on this site.': 'الحماية متوقفة على هذا الموقع.',
  'Protection is paused across websites.': 'الحماية متوقفة على جميع المواقع.',
  'Browser page': 'صفحة المتصفح', 'Open a website to use Sitr here.': 'افتح موقعًا لاستخدام ستر هنا.',
  'Refresh this tab to use the latest Sitr version.': 'حدّث هذا التبويب لاستخدام أحدث إصدار من ستر.',
  'No visible media on this page yet.': 'لا توجد صور أو فيديو ظاهر على هذه الصفحة بعد.',
  'Refresh this tab to connect Sitr.': 'حدّث هذا التبويب لتوصيل ستر.',
  'Website unavailable': 'الموقع غير متاح', 'Reopen Sitr on a regular website.': 'أعد فتح ستر على موقع ويب عادي.',
  'Loading settings…': 'جارٍ تحميل الإعدادات…', 'Retry': 'إعادة المحاولة', 'All settings': 'كل الإعدادات',
  'Saving…': 'جارٍ الحفظ…', 'Saved automatically': 'تُحفظ التغييرات تلقائيًا',
  'Could not save. Try the change again.': 'تعذّر الحفظ. أعد المحاولة.',
  'Unsaved websites. Save to apply.': 'المواقع غير محفوظة. احفظها للتطبيق.',
  'Websites saved': 'تم حفظ المواقع', 'Use valid website domains or URLs.': 'أدخل نطاقات أو روابط مواقع صحيحة.',
  'Keep the list to 100 websites or fewer.': 'يجب ألا تتجاوز القائمة ١٠٠ موقع.',
  'Could not open settings. Reopen Sitr and try again.': 'تعذّر فتح الإعدادات. أعد فتح ستر وحاول مجددًا.',
  'Open a regular website and try again.': 'افتح موقع ويب عاديًا وحاول مجددًا.',
  'Restarting engine…': 'جارٍ إعادة تشغيل المحرك…', 'Engine restarted': 'تمت إعادة تشغيل المحرك',
  'Could not restart the engine. Try again.': 'تعذّرت إعادة تشغيل المحرك. أعد المحاولة.',
  'Could not load settings.': 'تعذّر تحميل الإعدادات.',
  'Could not save display settings. Try again.': 'تعذّر حفظ إعدادات المظهر. أعد المحاولة.',
  'Could not load display settings. Try again.': 'تعذّر تحميل إعدادات المظهر. أعد المحاولة.',
  'Version {version}': 'الإصدار {version}', 'Auto · {size}': 'تلقائي · {size}', '{value} px': '{value} بكسل',
  'Theme and language': 'المظهر واللغة',
};

export function setLanguage(value: Language): void { language = value; }
export function currentLanguage(): Language { return language; }
export function t(source: string, values: Record<string, string | number> = {}): string {
  const text = language === 'ar' ? ARABIC[source] ?? source : source;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}
export function number(value: number): string { return new Intl.NumberFormat(language, { numberingSystem: language === 'ar' ? 'arab' : 'latn' }).format(value); }
export function percent(value: number): string { return new Intl.NumberFormat(language, { numberingSystem: language === 'ar' ? 'arab' : 'latn', style: 'percent', maximumFractionDigits: 0 }).format(value); }

export function mediaSummary(media: number, analyzed: number, detected: number): string {
  if (language === 'en') return `${number(media)} media item${media === 1 ? '' : 's'} · ${number(analyzed)} analyzed · ${number(detected)} people detected`;
  const mediaForms: Record<Intl.LDMLPluralRule, string> = {
    zero: 'لا يوجد محتوى', one: 'عنصر محتوى واحد', two: 'عنصرا محتوى', few: '{count} عناصر محتوى', many: '{count} عنصر محتوى', other: '{count} عنصر محتوى',
  };
  const peopleForms: Record<Intl.LDMLPluralRule, string> = {
    zero: 'لم يُكتشف أشخاص', one: 'اكتُشف شخص واحد', two: 'اكتُشف شخصان', few: 'اكتُشف {count} أشخاص', many: 'اكتُشف {count} شخصًا', other: 'اكتُشف {count} شخص',
  };
  const plural = new Intl.PluralRules('ar');
  const items = mediaForms[plural.select(media)].replace('{count}', number(media));
  const people = peopleForms[plural.select(detected)].replace('{count}', number(detected));
  return `${items} · تم تحليل ${number(analyzed)} · ${people}`;
}

// Translate individual text nodes, never innerHTML, preserving inputs, icons, and listeners.
export function captureStaticTranslations(): () => void {
  const texts: Array<{ node: Text; source: string; leading: string; trailing: string }> = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent || '';
    const source = text.trim();
    if (Object.hasOwn(ARABIC, source)) texts.push({ node: node as Text, source, leading: text.match(/^\s*/)?.[0] || '', trailing: text.match(/\s*$/)?.[0] || '' });
  }
  const attributes: Array<{ node: Element; name: string; source: string }> = [];
  document.querySelectorAll('[aria-label],[title],[placeholder]').forEach(node => {
    for (const name of ['aria-label', 'title', 'placeholder']) {
      const source = node.getAttribute(name);
      if (source && Object.hasOwn(ARABIC, source)) attributes.push({ node, name, source });
    }
  });
  return () => {
    texts.forEach(({ node, source, leading, trailing }) => { if (node.isConnected) node.textContent = leading + t(source) + trailing; });
    attributes.forEach(({ node, name, source }) => node.setAttribute(name, t(source)));
  };
}
