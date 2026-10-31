import { registerDictionary } from '@/i18n';
import type { OrderStatus } from '@goturtle/shared';

type D = { en: string; ar: string };

/** Friendly, consumer-facing status copy (title + body). {name} recipient first name, {hero}, {area}. */
const STATUS: Record<OrderStatus, { title: D; body: D }> = {
  CREATED: { title: { en: 'Order confirmed', ar: 'طلبك اتسجل' }, body: { en: 'The store is preparing your parcel for pickup.', ar: 'المتجر بيجهّز شحنتك علشان نستلمها.' } },
  PICKUP_ASSIGNED: { title: { en: 'Getting ready', ar: 'بنجهّز شحنتك' }, body: { en: 'A hero is on the way to collect your parcel from the store.', ar: 'مندوب في الطريق يستلم شحنتك من المتجر.' } },
  PICKED_UP: { title: { en: 'Picked up', ar: 'شحنتك معانا' }, body: { en: 'We have your parcel and it is heading to our hub.', ar: 'استلمنا شحنتك وهي في الطريق للمخزن.' } },
  RECEIVED_AT_HUB: { title: { en: 'At our hub', ar: 'في المخزن' }, body: { en: 'Your parcel is sorted and will head to {area} soon.', ar: 'شحنتك اتفرزت وهتتحرك لـ{area} قريب.' } },
  ASSIGNED: { title: { en: 'Assigned to a hero', ar: 'معاها مندوب' }, body: { en: '{hero} will deliver your parcel on the next run.', ar: '{hero} هيوصّل شحنتك في أقرب جولة.' } },
  OUT_FOR_DELIVERY: { title: { en: 'On the way to you!', ar: 'في الطريق ليك!' }, body: { en: '{hero} is out for delivery. Keep your phone close, {name}.', ar: '{hero} خرج للتوصيل. خلي موبايلك جنبك يا {name}.' } },
  DELIVERED: { title: { en: 'Delivered', ar: 'اتسلّمت' }, body: { en: 'Enjoy your order, {name}! Thanks for choosing us.', ar: 'بالهنا والشفا يا {name}! شكراً إنك اخترتنا.' } },
  FAILED_ATTEMPT: { title: { en: 'We missed you', ar: 'معرفناش نوصلك' }, body: { en: 'We could not deliver today. Pick a new day or fix the address below.', ar: 'معرفناش نسلّم النهارده. اختار يوم جديد أو عدّل العنوان تحت.' } },
  RESCHEDULED: { title: { en: 'New delivery day set', ar: 'اتحدد يوم جديد' }, body: { en: 'We will bring your parcel on the day you chose.', ar: 'هنجيبلك الشحنة في اليوم اللي اخترته.' } },
  ON_HOLD: { title: { en: 'Short pause', ar: 'وقفة قصيرة' }, body: { en: 'Your parcel is on hold while we sort something out. We will update you soon.', ar: 'الشحنة متوقفة مؤقتاً لحد ما نحل حاجة. هنبلغك قريب.' } },
  RETURN_PENDING: { title: { en: 'Returning to the store', ar: 'راجعة للمتجر' }, body: { en: 'This parcel is being returned to the store.', ar: 'الشحنة دي بترجع للمتجر.' } },
  RETURN_OUT: { title: { en: 'Returning to the store', ar: 'راجعة للمتجر' }, body: { en: 'A hero is taking the parcel back to the store.', ar: 'مندوب راجع بالشحنة للمتجر.' } },
  RETURNED: { title: { en: 'Returned to the store', ar: 'رجعت للمتجر' }, body: { en: 'The parcel is back with the store.', ar: 'الشحنة رجعت للمتجر.' } },
  CANCELLED: { title: { en: 'Order cancelled', ar: 'الطلب اتلغى' }, body: { en: 'This delivery was cancelled.', ar: 'التوصيل ده اتلغى.' } },
  LOST: { title: { en: 'We are looking into it', ar: 'بنراجع الموضوع' }, body: { en: 'Something went wrong with this parcel. Our team is on it.', ar: 'حصلت مشكلة في الشحنة دي وفريقنا شغال عليها.' } },
  DAMAGED: { title: { en: 'Parcel damaged', ar: 'الشحنة اتضررت' }, body: { en: 'We are sorry — the store will be in touch about a replacement.', ar: 'متأسفين جداً — المتجر هيتواصل معاك بخصوص البديل.' } },
};

const EXCEPTION: Partial<Record<OrderStatus, D>> = {
  RETURN_PENDING: { en: 'If you still want the order, contact the store — they can send it again.', ar: 'لو لسه عايز الطلب، كلّم المتجر وهما يقدروا يبعتوه تاني.' },
  RETURN_OUT: { en: 'If you still want the order, contact the store — they can send it again.', ar: 'لو لسه عايز الطلب، كلّم المتجر وهما يقدروا يبعتوه تاني.' },
  RETURNED: { en: 'Need it after all? The store can create a new delivery for you.', ar: 'محتاجه برضه؟ المتجر يقدر يعملك توصيل جديد.' },
  CANCELLED: { en: 'Nothing to pay. If this is unexpected, contact the store you ordered from.', ar: 'مفيش أي مبلغ عليك. لو ده مش متوقع، كلّم المتجر اللي طلبت منه.' },
  LOST: { en: 'You will not be charged. Contact support if you have any questions.', ar: 'مش هتدفع حاجة. كلّم الدعم لو عندك أي سؤال.' },
  DAMAGED: { en: 'You will not be charged for a damaged parcel.', ar: 'مش هتدفع حاجة على شحنة متضررة.' },
};

const EVENT: Record<OrderStatus, D> = {
  CREATED: { en: 'Order placed', ar: 'تم تسجيل الطلب' },
  PICKUP_ASSIGNED: { en: 'Hero heading to the store', ar: 'مندوب رايح للمتجر' },
  PICKED_UP: { en: 'Picked up from the store', ar: 'اتستلمت من المتجر' },
  RECEIVED_AT_HUB: { en: 'Arrived at our hub', ar: 'وصلت المخزن' },
  ASSIGNED: { en: 'Assigned to a hero', ar: 'اتسلّمت لمندوب' },
  OUT_FOR_DELIVERY: { en: 'Out for delivery', ar: 'خرجت للتوصيل' },
  DELIVERED: { en: 'Delivered', ar: 'اتسلّمت' },
  FAILED_ATTEMPT: { en: 'Delivery attempt failed', ar: 'محاولة توصيل لم تنجح' },
  RESCHEDULED: { en: 'Delivery rescheduled', ar: 'اتغيّر ميعاد التوصيل' },
  ON_HOLD: { en: 'On hold', ar: 'متوقفة مؤقتاً' },
  RETURN_PENDING: { en: 'Return started', ar: 'بدأ الإرجاع' },
  RETURN_OUT: { en: 'Returning to the store', ar: 'راجعة للمتجر' },
  RETURNED: { en: 'Returned to the store', ar: 'رجعت للمتجر' },
  CANCELLED: { en: 'Cancelled', ar: 'اتلغت' },
  LOST: { en: 'Under investigation', ar: 'قيد المراجعة' },
  DAMAGED: { en: 'Reported damaged', ar: 'متضررة' },
};

const dict: Record<string, D> = {
  'customer.footer': { en: 'Delivered with care by {name} · Cairo', ar: 'بيوصلك بحب مع {name} · القاهرة' },

  // landing
  'customer.landing.title': { en: 'Where’s my parcel?', ar: 'شحنتي فين؟' },
  'customer.landing.subtitle': { en: 'Track your delivery live, pick a better day or fix your address — no app needed.', ar: 'تابع شحنتك لحظة بلحظة، غيّر الميعاد أو صحّح العنوان — من غير تطبيق.' },
  'customer.landing.mode.track': { en: 'Track a parcel', ar: 'تتبع شحنة' },
  'customer.landing.mode.orders': { en: 'All my orders', ar: 'كل طلباتي' },
  'customer.landing.label': { en: 'Tracking number', ar: 'رقم التتبع' },
  'customer.landing.hint': { en: 'It starts with GT and is in the SMS we sent you.', ar: 'بيبدأ بـ GT وموجود في الرسالة اللي وصلتك.' },
  'customer.landing.cta': { en: 'Track', ar: 'تتبع' },
  'customer.landing.errFormat': { en: 'Tracking numbers look like GT followed by 10 digits.', ar: 'رقم التتبع شكله GT وبعدها ١٠ أرقام.' },
  'customer.landing.errCheck': { en: 'This number doesn’t look right — check for a typo.', ar: 'الرقم ده شكله فيه غلطة — راجعه تاني.' },
  'customer.landing.ordersTitle': { en: 'See every delivery to your phone', ar: 'شوف كل الشحنات اللي على رقمك' },
  'customer.landing.ordersHint': { en: 'We will text you a 6-digit code to confirm it’s you.', ar: 'هنبعتلك كود من ٦ أرقام نتأكد بيه إنه إنت.' },
  'customer.landing.signedInAs': { en: 'Signed in as', ar: 'داخل برقم' },
  'customer.landing.myOrders': { en: 'Show my orders', ar: 'اعرض طلباتي' },
  'customer.landing.feature.live': { en: 'Live map when your hero is on the way', ar: 'خريطة مباشرة والمندوب في الطريق' },
  'customer.landing.feature.reschedule': { en: 'Pick another day in two taps', ar: 'غيّر اليوم بضغطتين' },
  'customer.landing.feature.sms': { en: 'SMS updates at every step', ar: 'رسالة في كل خطوة' },
  'customer.landing.feature.all': { en: 'All your parcels in one place', ar: 'كل شحناتك في مكان واحد' },

  // otp
  'customer.otp.phone': { en: 'Mobile number', ar: 'رقم الموبايل' },
  'customer.otp.send': { en: 'Send code', ar: 'ابعت الكود' },
  'customer.otp.sent': { en: 'Code sent by SMS', ar: 'الكود اتبعت في رسالة' },
  'customer.otp.enter': { en: 'Enter the 6-digit code', ar: 'اكتب الكود (٦ أرقام)' },
  'customer.otp.code': { en: 'Verification code', ar: 'كود التحقق' },
  'customer.otp.sentTo': { en: 'Sent to', ar: 'اتبعت لـ' },
  'customer.otp.change': { en: 'change', ar: 'تغيير' },
  'customer.otp.verify': { en: 'Verify', ar: 'تأكيد' },
  'customer.otp.verified': { en: 'Verified — welcome!', ar: 'تم التأكيد — أهلاً بيك!' },
  'customer.otp.resendIn': { en: 'Resend code in {s}s', ar: 'إعادة الإرسال بعد {s} ث' },
  'customer.otp.resend': { en: 'Resend code', ar: 'ابعت الكود تاني' },
  'customer.otp.devCode': { en: 'Development code', ar: 'كود التطوير' },
  'customer.otp.hintMasked': { en: 'Enter the mobile number this parcel is for', ar: 'اكتب رقم الموبايل المسجل على الشحنة' },

  // tracking page
  'customer.track.another': { en: 'Track another', ar: 'تتبع شحنة تانية' },
  'customer.track.myOrders': { en: 'My orders', ar: 'طلباتي' },
  'customer.track.from': { en: 'Your order from {brand}', ar: 'طلبك من {brand}' },
  'customer.track.progress': { en: 'Delivery progress', ar: 'مراحل التوصيل' },
  'customer.track.attempts': { en: 'Attempt {n} of {max}', ar: 'محاولة {n} من {max}' },
  'customer.track.you': { en: 'You', ar: 'إنت' },
  'customer.track.live': { en: 'Live location', ar: 'الموقع المباشر' },
  'customer.track.updated': { en: 'Updated {time}', ar: 'آخر تحديث {time}' },
  'customer.track.mapLocked': { en: 'See your hero on the map', ar: 'شوف المندوب على الخريطة' },
  'customer.track.mapLockedHint': { en: 'Confirm your phone to unlock the live map', ar: 'أكّد رقمك علشان تفتح الخريطة المباشرة' },
  'customer.track.yourHero': { en: 'Your delivery hero', ar: 'المندوب بتاعك' },
  'customer.track.verifyTitle': { en: 'Is this your parcel, {name}?', ar: 'دي شحنتك يا {name}؟' },
  'customer.track.verifyHint': { en: 'Confirm your phone to see the amount, change the day, fix the address or rate the delivery.', ar: 'أكّد رقمك علشان تشوف المبلغ، تغيّر اليوم، تصحّح العنوان أو تقيّم التوصيل.' },
  'customer.track.history': { en: 'Shipment history', ar: 'رحلة الشحنة' },
  'customer.when.delivered': { en: 'Delivered {at}', ar: 'اتسلّمت {at}' },
  'customer.when.eta': { en: 'Arriving around {time}', ar: 'هتوصل حوالي {time}' },
  'customer.when.scheduled': { en: 'Scheduled for {day}', ar: 'ميعادها {day}' },
  'customer.when.by': { en: 'Expected by {day}', ar: 'متوقع توصل {day}' },

  // info
  'customer.info.toPay': { en: 'Amount to pay on delivery', ar: 'المبلغ المطلوب عند الاستلام' },
  'customer.info.cashHint': { en: 'Cash please — exact change helps the hero.', ar: 'كاش لو سمحت — والفكة بتساعد المندوب.' },
  'customer.info.prepaid': { en: 'Already paid — nothing to pay on delivery', ar: 'مدفوع — مفيش حاجة تدفعها عند الاستلام' },
  'customer.info.otpTitle': { en: 'Delivery code required', ar: 'مطلوب كود التسليم' },
  'customer.info.otpHint': { en: 'You will get a 4-digit code by SMS. Share it with the hero only after you receive your parcel.', ar: 'هيوصلك كود من ٤ أرقام في رسالة. ادّيه للمندوب بعد ما تستلم الشحنة بس.' },
  'customer.info.address': { en: 'Delivery address', ar: 'عنوان التوصيل' },
  'customer.info.package': { en: 'Package', ar: 'الشحنة' },
  'customer.info.items': { en: '{n} item(s)', ar: '{n} قطعة' },
  'customer.info.canOpen': { en: 'you may open it before paying', ar: 'مسموح تفتحها قبل الدفع' },
  'customer.info.noOpen': { en: 'opening before payment not allowed', ar: 'غير مسموح بالفتح قبل الدفع' },

  // actions
  'customer.act.title': { en: 'What would you like to do?', ar: 'تحب تعمل إيه؟' },
  'customer.act.rate': { en: 'Rate delivery', ar: 'قيّم التوصيل' },
  'customer.act.rateHint': { en: 'Tell us how it went', ar: 'قولنا كانت إزاي' },
  'customer.act.reschedule': { en: 'Change day', ar: 'غيّر اليوم' },
  'customer.act.rescheduleHint': { en: 'Pick any of the next 7 days', ar: 'اختار أي يوم في الأسبوع الجاي' },
  'customer.act.address': { en: 'Fix address', ar: 'صحّح العنوان' },
  'customer.act.addressHint': { en: 'Floor, landmark, map pin', ar: 'الدور، علامة مميزة، الخريطة' },
  'customer.act.support': { en: 'Get help', ar: 'محتاج مساعدة' },
  'customer.act.supportHint': { en: 'Message our team', ar: 'ابعت لفريقنا' },
  'customer.act.share': { en: 'Share', ar: 'مشاركة' },
  'customer.act.shareHint': { en: 'Send this tracking link', ar: 'ابعت لينك التتبع' },
  'customer.act.call': { en: 'Call support', ar: 'اتصل بالدعم' },
  'customer.act.waText': { en: 'Hi GoTurtle, I need help with my parcel {tn}', ar: 'أهلاً جو تيرتل، محتاج مساعدة في شحنتي {tn}' },
  'customer.act.thanksRated': { en: 'Thanks for rating your delivery!', ar: 'شكراً على تقييمك!' },
  'customer.share.cta': { en: 'Share tracking link', ar: 'شارك لينك التتبع' },
  'customer.share.title': { en: 'Track my parcel', ar: 'تتبع شحنتي' },
  'customer.share.text': { en: 'Follow parcel {tn} live:', ar: 'تابع الشحنة {tn} لحظة بلحظة:' },
  'customer.share.copied': { en: 'Link copied', ar: 'تم نسخ اللينك' },

  // reschedule
  'customer.resched.title': { en: 'Choose a delivery day', ar: 'اختار يوم التوصيل' },
  'customer.resched.hint': { en: 'We deliver between 9 am and 9 pm.', ar: 'بنوصّل من ٩ الصبح لـ ٩ بالليل.' },
  'customer.resched.tomorrow': { en: 'Tomorrow', ar: 'بكرة' },
  'customer.resched.note': { en: 'Note for the hero (optional)', ar: 'ملاحظة للمندوب (اختياري)' },
  'customer.resched.notePh': { en: 'e.g. please come after 5 pm', ar: 'مثلاً: ياريت بعد الساعة ٥' },
  'customer.resched.confirm': { en: 'Confirm new day', ar: 'تأكيد اليوم الجديد' },
  'customer.resched.done': { en: 'Done! We will deliver on {day}', ar: 'تمام! هنوصّل يوم {day}' },

  // address
  'customer.addr.title': { en: 'Help your hero find you', ar: 'ساعد المندوب يوصلك' },
  'customer.addr.hint': { en: 'Add details or drop a pin — the street and area stay the same.', ar: 'ضيف تفاصيل أو حدد مكانك على الخريطة — الشارع والمنطقة زي ما هما.' },
  'customer.addr.building': { en: 'Building', ar: 'العمارة' },
  'customer.addr.floor': { en: 'Floor', ar: 'الدور' },
  'customer.addr.apartment': { en: 'Apartment', ar: 'الشقة' },
  'customer.addr.landmark': { en: 'Landmark', ar: 'علامة مميزة' },
  'customer.addr.landmarkPh': { en: 'Next to the pharmacy…', ar: 'جنب الصيدلية…' },
  'customer.addr.notes': { en: 'Directions for the hero', ar: 'إرشادات للمندوب' },
  'customer.addr.notesPh': { en: 'Second entrance, ring twice…', ar: 'المدخل التاني، اضرب الجرس مرتين…' },
  'customer.addr.pin': { en: 'Your exact location', ar: 'مكانك بالظبط' },
  'customer.addr.pinHint': { en: 'Tap the map or drag the pin', ar: 'دوس على الخريطة أو اسحب الدبوس' },
  'customer.addr.useGps': { en: 'Use my location', ar: 'استخدم موقعي' },
  'customer.addr.gpsFail': { en: 'Could not get your location', ar: 'معرفناش نحدد موقعك' },
  'customer.addr.save': { en: 'Save address details', ar: 'حفظ تفاصيل العنوان' },
  'customer.addr.done': { en: 'Thanks! Your hero will see the new details', ar: 'شكراً! المندوب هيشوف التفاصيل الجديدة' },
  'customer.addr.outOfZone': { en: 'That pin is too far from the delivery area — contact support to change the area.', ar: 'الدبوس بعيد عن منطقة التوصيل — كلّم الدعم لتغيير المنطقة.' },
  'customer.addr.locked': { en: 'The parcel is already on its way — call the hero or support to change the address.', ar: 'الشحنة في الطريق خلاص — كلّم المندوب أو الدعم لتغيير العنوان.' },

  // rating
  'customer.rate.title': { en: 'How was your delivery?', ar: 'التوصيل كان عامل إيه؟' },
  'customer.rate.hint': { en: 'Your rating helps us reward great heroes.', ar: 'تقييمك بيساعدنا نكافئ المندوبين الشاطرين.' },
  'customer.rate.hintHero': { en: 'Rate {hero} — great heroes get rewarded.', ar: 'قيّم {hero} — المندوبين الشاطرين بياخدوا مكافآت.' },
  'customer.rate.stars': { en: '{n} stars', ar: '{n} نجوم' },
  'customer.rate.l1': { en: 'Very bad', ar: 'وحش جداً' },
  'customer.rate.l2': { en: 'Not good', ar: 'مش كويس' },
  'customer.rate.l3': { en: 'Okay', ar: 'مقبول' },
  'customer.rate.l4': { en: 'Good', ar: 'كويس' },
  'customer.rate.l5': { en: 'Excellent!', ar: 'ممتاز!' },
  'customer.rate.comment': { en: 'Anything to add? (optional)', ar: 'حابب تضيف حاجة؟ (اختياري)' },
  'customer.rate.commentPh': { en: 'The hero was polite and on time…', ar: 'المندوب كان محترم وفي الميعاد…' },
  'customer.rate.send': { en: 'Send rating', ar: 'إرسال التقييم' },
  'customer.rate.thanks': { en: 'Thank you for your feedback!', ar: 'شكراً على رأيك!' },

  // support
  'customer.support.title': { en: 'How can we help?', ar: 'نقدر نساعدك إزاي؟' },
  'customer.support.hint': { en: 'Our team replies by SMS or a call, usually within a few hours.', ar: 'فريقنا بيرد برسالة أو مكالمة، عادةً خلال ساعات.' },
  'customer.support.about': { en: 'It’s about', ar: 'بخصوص' },
  'customer.support.message': { en: 'Message', ar: 'الرسالة' },
  'customer.support.messagePh': { en: 'Tell us what happened…', ar: 'احكيلنا حصل إيه…' },
  'customer.support.send': { en: 'Send message', ar: 'إرسال' },
  'customer.support.sent': { en: 'Message received', ar: 'رسالتك وصلت' },
  'customer.support.sentHint': { en: 'Reference {code}. We will get back to you soon.', ar: 'رقم المتابعة {code}. هنرد عليك قريب.' },
  'customer.support.cat.INQUIRY': { en: 'A question', ar: 'سؤال' },
  'customer.support.cat.DELAY': { en: 'Late delivery', ar: 'تأخير' },
  'customer.support.cat.RESCHEDULE': { en: 'Delivery time', ar: 'ميعاد التوصيل' },
  'customer.support.cat.ADDRESS_CHANGE': { en: 'Change address / area', ar: 'تغيير العنوان أو المنطقة' },
  'customer.support.cat.COD_ISSUE': { en: 'Amount to pay', ar: 'المبلغ المطلوب' },
  'customer.support.cat.DAMAGED': { en: 'Damaged parcel', ar: 'شحنة متضررة' },
  'customer.support.cat.COURIER_BEHAVIOR': { en: 'The hero', ar: 'المندوب' },
  'customer.support.cat.COMPLAINT': { en: 'Complaint or feedback', ar: 'شكوى أو رأي' },
  'customer.support.cat.OTHER': { en: 'Something else', ar: 'حاجة تانية' },

  // not found
  'customer.nf.title': { en: 'We couldn’t find that parcel', ar: 'ملقيناش الشحنة دي' },
  'customer.nf.body': { en: 'No shipment matches “{tn}”.', ar: 'مفيش شحنة برقم «{tn}».' },
  'customer.nf.tip1': { en: 'Copy the number exactly from the SMS (GT + 10 digits).', ar: 'انسخ الرقم زي ما هو من الرسالة (GT + ١٠ أرقام).' },
  'customer.nf.tip2': { en: 'New orders can take a few minutes to appear.', ar: 'الطلبات الجديدة ممكن تاخد دقايق علشان تظهر.' },
  'customer.nf.tip3': { en: 'Still stuck? Ask the store for your tracking number.', ar: 'لسه مش لاقيها؟ اسأل المتجر على رقم التتبع.' },
  'customer.nf.again': { en: 'Try another number', ar: 'جرّب رقم تاني' },

  // my orders
  'customer.orders.title': { en: 'My orders', ar: 'طلباتي' },
  'customer.orders.signOut': { en: 'Sign out', ar: 'خروج' },
  'customer.orders.active': { en: 'On the way ({n})', ar: 'في الطريق ({n})' },
  'customer.orders.past': { en: 'Past deliveries', ar: 'شحنات سابقة' },
  'customer.orders.empty': { en: 'No parcels for this number yet', ar: 'مفيش شحنات على الرقم ده لسه' },
  'customer.orders.emptyHint': { en: 'When a store ships to you with GoTurtle it will show up here.', ar: 'لما متجر يبعتلك مع جو تيرتل هتظهر هنا.' },
  'customer.orders.rateNow': { en: 'Rate', ar: 'قيّم' },

  // vehicles & reasons
  'customer.vehicle.MOTORCYCLE': { en: 'Motorcycle', ar: 'موتوسيكل' },
  'customer.vehicle.SCOOTER': { en: 'Scooter', ar: 'سكوتر' },
  'customer.vehicle.BICYCLE': { en: 'Bicycle', ar: 'عجلة' },
  'customer.vehicle.CAR': { en: 'Car', ar: 'عربية' },
  'customer.vehicle.VAN': { en: 'Van', ar: 'فان' },
  'customer.vehicle.ON_FOOT': { en: 'On foot', ar: 'سيراً' },
  'customer.reason.CUSTOMER_UNREACHABLE': { en: 'We couldn’t reach you by phone', ar: 'معرفناش نوصلك على التليفون' },
  'customer.reason.CUSTOMER_REFUSED': { en: 'The parcel was refused', ar: 'الشحنة اترفضت' },
  'customer.reason.CUSTOMER_RESCHEDULED': { en: 'You asked for another day', ar: 'طلبت يوم تاني' },
  'customer.reason.WRONG_ADDRESS': { en: 'The address seems wrong', ar: 'العنوان شكله غلط' },
  'customer.reason.INCOMPLETE_ADDRESS': { en: 'The address is missing details', ar: 'العنوان ناقص تفاصيل' },
  'customer.reason.NO_CASH': { en: 'Cash wasn’t ready', ar: 'الفلوس مكانتش جاهزة' },
  'customer.reason.CUSTOMER_NOT_PRESENT': { en: 'Nobody was home', ar: 'محدش كان موجود' },
  'customer.reason.OUT_OF_ZONE': { en: 'Outside our delivery area', ar: 'خارج منطقة التوصيل' },
  'customer.reason.PACKAGE_DAMAGED': { en: 'The parcel was damaged', ar: 'الشحنة اتضررت' },
  'customer.reason.SECURITY_ACCESS': { en: 'Security didn’t let us in', ar: 'الأمن مدخلناش' },
  'customer.reason.OTHER': { en: 'Something came up', ar: 'حصل ظرف' },
};

for (const [s, v] of Object.entries(STATUS)) {
  dict[`customer.status.${s}.title`] = v.title;
  dict[`customer.status.${s}.body`] = v.body;
}
for (const [s, v] of Object.entries(EXCEPTION)) dict[`customer.exception.${s}`] = v;
for (const [s, v] of Object.entries(EVENT)) dict[`customer.event.${s}`] = v;

registerDictionary(dict);
