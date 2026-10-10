// Trilingual strings for the account pages (Group B).
//
// Verbatim from js/i18n.{ar,fr,en}.js (production 0.0.0.43).
// Language stored in localStorage 'dlala_lang' (default 'ar'),
// mirroring js/i18n.js exactly.

'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type Lang = 'ar' | 'fr' | 'en';

const STRINGS: Record<Lang, Record<string, string>> = {
  ar: {
    account: 'حسابي', settings: 'الإعدادات', myAds: 'إعلاناتي', myFollows: 'متابعاتي',
    dismiss: 'إغلاق', comingSoon: 'سيتوفر قريبًا',
    downloadAppTitle: 'حمّل تطبيق دلالة على موبايلك',
    newFromFollows: 'جديد من متابَعيك',
    favorites: 'المفضلة', editProfile: 'تعديل الملف الشخصي', saveProfile: 'حفظ الملف',
    profileSaved: 'تم حفظ الملف الشخصي', loading: 'جارٍ التحميل...', retry: 'إعادة المحاولة',
    createProfile: 'إنشاء الملف الشخصي',
    profileMissing: 'لم يتم العثور على ملفك الشخصي — أنشئ واحداً للمتابعة',
    changePhoto: 'تغيير الصورة', name: 'الاسم (باللاتينية)', username: 'اسم المستخدم',
    bio: 'نبذة', usernameEx: 'مثال: amine_dz',
    invalidName: 'الاسم: أحرف لاتينية فقط (2-40 حرفاً)',
    invalidUsername: 'اسم المستخدم: 3-20 حرفاً (أحرف لاتينية صغيرة، أرقام، . _)',
    bioTooLong: 'النبذة طويلة جداً (الحد 300 حرف)', usernameTaken: 'اسم المستخدم محجوز',
    photoTooBig: 'الصورة كبيرة جداً (الحد 5MB)', errorPhoto: 'يرجى اختيار صور فقط.',
    myStore: 'متجري', storeCoverLabel: 'صورة غلاف المتجر', storeLogoLabel: 'شعار المتجر',
    storeNameLabel: 'اسم المتجر', storeBioLabel: 'وصف المتجر',
    storeNameTooLong: 'اسم المتجر طويل جداً (60 حرفاً كحد أقصى)',
    storeBioTooLong: 'وصف المتجر طويل جداً (500 حرف كحد أقصى)',
    settingsAccount: 'الحساب', settingsPreferences: 'التفضيلات', settingsLanguage: 'اللغة',
    settingsCache: 'التخزين المؤقت',
    settingsCacheDesc: 'بيانات مؤقتة مخزّنة على جهازك لتسريع التطبيق.',
    clearCache: 'مسح البيانات المؤقتة', cacheCleared: 'تم مسح البيانات المؤقتة',
    cacheClearFailed: 'تعذّر مسح البيانات المؤقتة', settingsSupport: 'الدعم',
    reportProblem: 'الإبلاغ عن مشكلة', reportProblemDesc: 'صف الخلل الذي واجهته وسننظر فيه',
    contactSupport: 'اتصل بنا', contactSupportDesc: 'تحدث مع فريق دعم دلالة',
    blockedUsers: 'المستخدمون المحظورون', noBlockedUsers: 'لا يوجد مستخدمون محظورون.',
    unblock: 'إلغاء الحظر', userUnblocked: 'تم إلغاء حظر المستخدم.',
    blockFailed: 'تعذّر تحديث الحظر — حاول مجدداً.', settingsAbout: 'حول',
    termsLink: 'شروط الاستخدام', privacyLink: 'سياسة الخصوصية', appVersion: 'إصدار التطبيق',
    dangerZone: 'منطقة الخطر', deleteAccount: 'حذف الحساب',
    deleteAccountWarn: 'سيتم حذف حسابك وجميع بياناتك نهائياً: إعلاناتك، صورك، رسائلك وتقييماتك. هذا الإجراء لا يمكن التراجع عنه.',
    deleteAccountStep2: 'للتأكيد، اكتب كلمة «احذف» في الخانة أدناه:',
    typeDeleteWord: 'اكتب «احذف»', deleteWord: 'احذف', deleteMismatch: 'الكلمة غير صحيحة.',
    accountDeletionWarning: 'تحذير أخير: حذف حسابك نهائي ولا يمكن التراجع عنه. سيُفقد اسم المستخدم الخاص بك نهائيًا وقد يستعمله شخص آخر. ستُحذف إعلاناتك ومحادثاتك وجميع بياناتك نهائيًا. بريدك الإلكتروني سيصبح قابلًا للتسجيل مجددًا بعد فترة سماح 30 يومًا.',
    reauthPasswordLabel: 'أدخل كلمة المرور للتأكيد', wrongPassword: 'كلمة المرور غير صحيحة',
    deletionFailed: 'تعذّر إرسال طلب الحذف. حاول مجدداً.',
    deletionRequested: 'تم استلام طلب الحذف. سيتم حذف حسابك وبياناتك نهائياً.',
    reauthNeeded: 'سجّل الدخول مجدداً لإتمام الحذف',
    reportSubject: 'الموضوع', reportSubjectPh: 'مثال: تعذّر نشر إعلان',
    reportBody: 'وصف المشكلة', reportBodyPh: 'اشرح ما حدث بالتفصيل...',
    reportEmpty: 'يرجى كتابة وصف للمشكلة', reportSend: 'إرسال البلاغ',
    reportSent: 'تم إرسال البلاغ. شكراً لك.', reportFailed: 'تعذّر إرسال البلاغ. حاول مجدداً.',
    edit: 'تعديل', markSold: 'تم البيع',
    markSoldConfirm: 'هل أنت متأكد من وضع علامة "تم البيع" على هذا الإعلان؟',
    delete: 'حذف', noAds: 'لم تنشر أي إعلان بعد', publish: 'انشر إعلان',
    errorGeneric: 'حدث خطأ — حاول مجدداً',
    authConnectionProblem: 'مشكلة في الاتصال — تحقق من الإنترنت وحاول مجدداً',
    stillNotVerified: 'لم يتم التفعيل بعد', iVerifiedContinue: 'لقد تحققت، تابع',
    resendEmail: 'إعادة إرسال الرابط',
    verifyEmailBody: 'أرسلنا لك رابط التفعيل. فعّل بريدك لتتمكن من النشر ومراسلة البائعين.',
    noFollows: 'لا تتابع أحدًا بعد',
    noFollowsHint: 'تابع متاجرك وبائعيك المفضلين لتصلك إعلاناتهم أولاً',
    browseStores: 'تصفح الإعلانات', proMerchant: 'تاجر محترف', followers: 'متابع',
    yourListing: 'إعلانك',
    following: 'أتابع', newBadge: 'جديد',
    noFavorites: 'لا توجد مفضلة بعد', noFavoritesHint: 'اضغط على ♥ في أي إعلان لحفظه هنا',
    browseAds: 'تصفح الإعلانات', loadMore: 'عرض المزيد', removeFavorite: 'إزالة من المفضلة',
    favListingRemoved: 'تمت إزالة هذا الإعلان', favCardLoadFailed: 'تعذّر تحميل هذا الإعلان', priceDropped: 'انخفض السعر!',
    adsReloadFailed: 'تعذّر تحديث الجلسة — تُعرض الإعلانات بالبيانات المخزّنة',
    skipToContent: 'تخطَّ إلى المحتوى', appName: 'دلالة',
    tagline: 'إعلانات مرتبة، بائعون موثوقون', logout: 'تسجيل الخروج', login: 'تسجيل الدخول',
    condNew: 'جديد', condUsed: 'مستعمل',
    // Site chrome (Group C) — verbatim from js/i18n.ar.js (js/app.js renderChrome parity).
    menu: 'القائمة', close: 'إغلاق', home: 'الرئيسية', wanted: 'مطلوب',
    announcements: 'إعلانات الفريق', messages: 'الرسائل', alerts: 'التنبيهات',
    allRights: 'دلالة — سوق الجزائر الحر',
    guidesTitle: 'أدلة الشراء', guideCar: 'دليل السيارات', guidePrices: 'دليل الأسعار',
    guidePhone: 'دليل الهواتف', guideScam: 'دليل الحماية من الاحتيال',
    signup: 'حساب جديد', navMain: 'أقسام رئيسية', navSpace: 'مساحتي', navHelp: 'المساعدة',
    profileLoadError: 'تعذّر تحميل الملف الشخصي', unverifiedBadge: 'غير مفعّل',
    vitrine: 'الواجهة', storeVerify: 'توثيق المتجر',
    logoutFailed: 'تعذّر تسجيل الخروج — تحقق من الاتصال وحاول مجدداً.',
    // Home page (Group D, Round 107) — verbatim js/i18n.ar.js unless noted.
    search: 'ابحث...', searchBtn: 'بحث',
    allCategories: 'كل الأقسام', wantedOnly: 'مطلوب فقط',
    categoriesNav: 'الفئات', // port-added (nav aria-label)
    wilaya: 'الولاية', allWilayas: 'كل الولايات',
    minPrice: 'السعر الأدنى', maxPrice: 'السعر الأقصى',
    sortLabel: 'ترتيب حسب', sortRecent: 'الأحدث',
    sortPriceAsc: 'السعر: من الأقل', sortPriceDesc: 'السعر: من الأعلى',
    applyFilters: 'تطبيق', resetFilters: 'مسح',
    latestAds: 'أحدث الإعلانات', // port-added (home feed heading)
    feedEmpty: 'لا توجد إعلانات حاليا.', // port-added (home empty state)
    condGood: 'جيد',
    loadMoreFailed: 'تعذر تحميل المزيد', // port-added (load-more error)
    follow: 'متابعة', loginToFollow: 'سجّل الدخول للمتابعة',
    loginToFavorite: 'سجّل الدخول لإضافة الإعلان إلى المفضلة',
    discoverStore: 'اكتشف متجر',
    wantedBadge: 'مطلوب', sold: 'مباع', wholesale: 'الجملة',
    priceReduced: 'انخفض السعر', seekerBadge: 'باحث عن عمل', offerBadge: 'عرض عمل',
  },
  fr: {
    account: 'Mon compte', settings: 'Paramètres', myAds: 'Mes annonces', myFollows: 'Mes abonnements',
    dismiss: 'Fermer', comingSoon: 'Bientôt disponible',
    downloadAppTitle: 'Téléchargez l’app Dlala sur votre mobile',
    newFromFollows: 'Nouveautés de vos abonnements',
    favorites: 'Favoris', editProfile: 'Modifier le profil', saveProfile: 'Enregistrer',
    profileSaved: 'Profil enregistré', loading: 'Chargement...', retry: 'Réessayer',
    createProfile: 'Créer le profil',
    profileMissing: 'Profil introuvable — créez-en un pour continuer',
    changePhoto: 'Changer la photo', name: 'Nom (en latin)', username: "Nom d’utilisateur",
    bio: 'Bio', usernameEx: 'ex : amine_dz',
    invalidName: 'Nom : lettres latines uniquement (2-40 caractères)',
    invalidUsername: "Nom d'utilisateur : 3-20 caractères (minuscules, chiffres, . _)",
    bioTooLong: 'Bio trop longue (300 caractères max)', usernameTaken: "Nom d'utilisateur déjà pris",
    photoTooBig: 'Photo trop lourde (5 Mo max)', errorPhoto: 'Veuillez choisir des images uniquement.',
    myStore: 'Ma boutique', storeCoverLabel: 'Photo de couverture', storeLogoLabel: 'Logo de la boutique',
    storeNameLabel: 'Nom de la boutique', storeBioLabel: 'Description de la boutique',
    storeNameTooLong: 'Nom de boutique trop long (60 caractères max)',
    storeBioTooLong: 'Description trop longue (500 caractères max)',
    settingsAccount: 'Compte', settingsPreferences: 'Préférences', settingsLanguage: 'Langue',
    settingsCache: 'Cache',
    settingsCacheDesc: "Données temporaires stockées sur votre appareil pour accélérer l'application.",
    clearCache: 'Effacer le cache', cacheCleared: 'Cache effacé',
    cacheClearFailed: "Impossible d'effacer le cache", settingsSupport: 'Assistance',
    reportProblem: 'Signaler un problème', reportProblemDesc: 'Décrivez le problème rencontré, nous l\'examinerons',
    contactSupport: 'Nous contacter', contactSupportDesc: "Discutez avec l'équipe d'assistance Dlala",
    blockedUsers: 'Utilisateurs bloqués', noBlockedUsers: 'Aucun utilisateur bloqué.',
    unblock: 'Débloquer', userUnblocked: 'Utilisateur débloqué.',
    blockFailed: 'Impossible de mettre à jour le blocage — réessayez.', settingsAbout: 'À propos',
    termsLink: "Conditions d'utilisation", privacyLink: 'Confidentialité', appVersion: "Version de l'application",
    dangerZone: 'Zone dangereuse', deleteAccount: 'Supprimer le compte',
    deleteAccountWarn: 'Votre compte et toutes vos données seront définitivement supprimés : annonces, photos, messages et avis. Cette action est irréversible.',
    deleteAccountStep2: 'Pour confirmer, tapez le mot « SUPPRIMER » ci-dessous :',
    typeDeleteWord: 'Tapez « SUPPRIMER »', deleteWord: 'SUPPRIMER', deleteMismatch: 'Mot incorrect.',
    accountDeletionWarning: "Dernier avertissement : la suppression de votre compte est définitive et irréversible. Votre nom d'utilisateur sera perdu à jamais et pourra être repris par quelqu'un d'autre. Vos annonces, conversations et toutes vos données seront définitivement supprimées. Votre adresse e-mail pourra être réutilisée après un délai de grâce de 30 jours.",
    reauthPasswordLabel: 'Saisissez votre mot de passe pour confirmer', wrongPassword: 'Mot de passe incorrect',
    deletionFailed: "Échec de l'envoi. Réessayez.",
    deletionRequested: 'Demande de suppression reçue. Votre compte et vos données seront définitivement supprimés.',
    reauthNeeded: 'Reconnectez-vous pour terminer la suppression',
    reportSubject: 'Sujet', reportSubjectPh: 'Ex. : impossible de publier une annonce',
    reportBody: 'Description du problème', reportBodyPh: "Décrivez ce qui s'est passé en détail...",
    reportEmpty: 'Veuillez décrire le problème', reportSend: 'Envoyer le signalement',
    reportSent: 'Signalement envoyé. Merci.', reportFailed: "Échec de l'envoi. Réessayez.",
    edit: 'Modifier', markSold: 'Marquer vendu',
    markSoldConfirm: 'Marquer cette annonce comme vendue ?',
    delete: 'Supprimer', noAds: 'Vous n’avez pas encore publié d’annonce', publish: 'Publier',
    errorGeneric: 'Une erreur est survenue — réessayez',
    authConnectionProblem: 'Problème de connexion — vérifiez votre connexion Internet et réessayez',
    stillNotVerified: 'Pas encore vérifié', iVerifiedContinue: "J'ai vérifié, continuer",
    resendEmail: 'Renvoyer le lien',
    verifyEmailBody: 'Nous vous avons envoyé un lien d’activation. Vérifiez votre e-mail pour publier et contacter les vendeurs.',
    noFollows: 'Vous ne suivez personne pour le moment',
    noFollowsHint: 'Suivez vos boutiques et vendeurs préférés pour voir leurs annonces en premier',
    browseStores: 'Parcourir les annonces', proMerchant: 'Commerçant pro', followers: 'abonnés',
    yourListing: 'Votre annonce',
    following: 'Suivi', newBadge: 'Nouveau',
    noFavorites: 'Aucun favori pour le moment', noFavoritesHint: 'Touchez ♥ sur une annonce pour la retrouver ici',
    browseAds: 'Parcourir les annonces', loadMore: 'Afficher plus', removeFavorite: 'Retirer des favoris',
    favListingRemoved: 'Cette annonce a été supprimée', favCardLoadFailed: "Impossible de charger cette annonce", priceDropped: 'Prix en baisse !',
    adsReloadFailed: 'Actualisation de la session impossible — annonces affichées avec les données en cache',
    skipToContent: 'Aller au contenu', appName: 'DLALA',
    tagline: 'Annonces claires, vendeurs vérifiés', logout: 'Déconnexion', login: 'Connexion',
    condNew: 'Neuf', condUsed: 'Occasion',
    // Site chrome (Group C) — verbatim from js/i18n.fr.js (js/app.js renderChrome parity).
    menu: 'Menu', close: 'Fermer', home: 'Accueil', wanted: 'Recherché',
    announcements: "Annonces de l'équipe", messages: 'Messages', alerts: 'Alertes',
    allRights: 'DLALA — le souk libre d’Algérie',
    guidesTitle: 'Guides d’achat', guideCar: 'Guide voitures', guidePrices: 'Guide des prix',
    guidePhone: 'Guide téléphones', guideScam: 'Guide anti-arnaques',
    signup: 'Créer un compte', navMain: 'Principal', navSpace: 'Mon espace', navHelp: 'Aide',
    profileLoadError: 'Impossible de charger le profil', unverifiedBadge: 'Non vérifié',
    vitrine: 'Vitrine', storeVerify: 'Vérification boutique',
    logoutFailed: 'Échec de la déconnexion — vérifiez votre connexion et réessayez.',
    // Home page (Group D, Round 107) — verbatim js/i18n.fr.js unless noted.
    search: 'Rechercher...', searchBtn: 'Chercher',
    allCategories: 'Toutes catégories', wantedOnly: 'Recherchés uniquement',
    categoriesNav: 'Catégories', // port-added (nav aria-label)
    wilaya: 'Wilaya', allWilayas: 'Toutes wilayas',
    minPrice: 'Prix min', maxPrice: 'Prix max',
    sortLabel: 'Trier par', sortRecent: 'Plus récents',
    sortPriceAsc: 'Prix croissant', sortPriceDesc: 'Prix décroissant',
    applyFilters: 'Appliquer', resetFilters: 'Effacer',
    latestAds: 'Dernières annonces', // port-added (home feed heading)
    feedEmpty: 'Aucune annonce pour le moment.', // port-added (home empty state)
    condGood: 'Bon état',
    loadMoreFailed: 'Impossible de charger la suite', // port-added (load-more error)
    follow: 'Suivre', loginToFollow: 'Connectez-vous pour suivre',
    loginToFavorite: 'Connectez-vous pour ajouter cette annonce aux favoris',
    discoverStore: 'Découvrez la boutique',
    wantedBadge: 'Recherché', sold: 'Vendu', wholesale: 'Gros',
    priceReduced: 'Prix réduit', seekerBadge: 'باحث عن عمل', offerBadge: 'عرض عمل',
  },
  en: {
    account: 'My account', settings: 'Settings', myAds: 'My ads', myFollows: 'My follows',
    dismiss: 'Dismiss', comingSoon: 'Coming soon',
    downloadAppTitle: 'Get the Dlala app on your mobile',
    newFromFollows: 'New from your follows',
    favorites: 'Favorites', editProfile: 'Edit profile', saveProfile: 'Save profile',
    profileSaved: 'Profile saved', loading: 'Loading...', retry: 'Try again',
    createProfile: 'Create profile',
    profileMissing: 'Profile not found — create one to continue',
    changePhoto: 'Change photo', name: 'Name (Latin script)', username: 'Username',
    bio: 'Bio', usernameEx: 'e.g. amine_dz',
    invalidName: 'Name: latin letters only (2-40 chars)',
    invalidUsername: 'Username: 3-20 chars (lowercase latin, digits, . _)',
    bioTooLong: 'Bio too long (300 chars max)', usernameTaken: 'Username already taken',
    photoTooBig: 'Photo too big (5MB max)', errorPhoto: 'Please choose images only.',
    myStore: 'My store', storeCoverLabel: 'Store cover photo', storeLogoLabel: 'Store logo',
    storeNameLabel: 'Store name', storeBioLabel: 'Store description',
    storeNameTooLong: 'Store name too long (60 characters max)',
    storeBioTooLong: 'Store bio too long (500 characters max)',
    settingsAccount: 'Account', settingsPreferences: 'Preferences', settingsLanguage: 'Language',
    settingsCache: 'Cache',
    settingsCacheDesc: 'Temporary data stored on your device to speed up the app.',
    clearCache: 'Clear cache', cacheCleared: 'Cache cleared',
    cacheClearFailed: "Couldn't clear the cached data", settingsSupport: 'Support',
    reportProblem: 'Report a problem', reportProblemDesc: "Describe the issue you hit and we'll look into it",
    contactSupport: 'Contact us', contactSupportDesc: 'Chat with the Dlala support team',
    blockedUsers: 'Blocked users', noBlockedUsers: 'No blocked users.',
    unblock: 'Unblock', userUnblocked: 'User unblocked.',
    blockFailed: 'Could not update the block — try again.', settingsAbout: 'About',
    termsLink: 'Terms of Use', privacyLink: 'Privacy', appVersion: 'App version',
    dangerZone: 'Danger zone', deleteAccount: 'Delete account',
    deleteAccountWarn: 'Your account and all your data will be permanently deleted: listings, photos, messages and reviews. This cannot be undone.',
    deleteAccountStep2: 'To confirm, type the word “DELETE” below:',
    typeDeleteWord: 'Type “DELETE”', deleteWord: 'DELETE', deleteMismatch: 'Incorrect word.',
    accountDeletionWarning: 'Final warning: deleting your account is permanent and irreversible. Your username will be lost forever and may be taken by someone else. Your listings, chats, and all your data will be permanently deleted. Your email address will become re-registerable after a 30-day grace period.',
    reauthPasswordLabel: 'Enter your password to confirm', wrongPassword: 'Incorrect password',
    deletionFailed: 'Could not send the request. Try again.',
    deletionRequested: 'Deletion request received. Your account and data will be permanently deleted.',
    reauthNeeded: 'Sign in again to complete the deletion',
    reportSubject: 'Subject', reportSubjectPh: "E.g.: can't publish a listing",
    reportBody: 'Problem description', reportBodyPh: 'Describe what happened in detail...',
    reportEmpty: 'Please describe the problem', reportSend: 'Send report',
    reportSent: 'Report sent. Thank you.', reportFailed: 'Could not send the report. Try again.',
    edit: 'Edit', markSold: 'Mark as sold',
    markSoldConfirm: 'Mark this listing as sold?',
    delete: 'Delete', noAds: 'You have not published any ad yet', publish: 'Post an ad',
    errorGeneric: 'Something went wrong — try again',
    authConnectionProblem: 'Connection problem — check your internet connection and try again',
    stillNotVerified: 'Not verified yet', iVerifiedContinue: "I've verified, continue",
    resendEmail: 'Resend the link',
    verifyEmailBody: 'We sent you an activation link. Verify your email to publish and contact sellers.',
    noFollows: "You're not following anyone yet",
    noFollowsHint: 'Follow your favorite stores and sellers to see their listings first',
    browseStores: 'Browse listings', proMerchant: 'Pro merchant', followers: 'followers',
    yourListing: 'Your listing',
    following: 'Following', newBadge: 'New',
    noFavorites: 'No favorites yet', noFavoritesHint: 'Tap ♥ on any listing to save it here',
    browseAds: 'Browse listings', loadMore: 'Show more', removeFavorite: 'Remove from favorites',
    favListingRemoved: 'This listing was removed', favCardLoadFailed: 'Could not load this listing', priceDropped: 'Price dropped!',
    adsReloadFailed: 'Could not refresh session — showing ads with cached data',
    skipToContent: 'Skip to content', appName: 'DLALA',
    tagline: 'Clear ads, trusted sellers', logout: 'Sign out', login: 'Sign in',
    condNew: 'New', condUsed: 'Used',
    // Site chrome (Group C) — verbatim from js/i18n.en.js (js/app.js renderChrome parity).
    menu: 'Menu', close: 'Close', home: 'Home', wanted: 'Wanted',
    announcements: 'Team announcements', messages: 'Messages', alerts: 'Alerts',
    allRights: 'DLALA — Algeria’s free souk',
    guidesTitle: 'Buying guides', guideCar: 'Car guide', guidePrices: 'Price guide',
    guidePhone: 'Phone guide', guideScam: 'Scam protection guide',
    signup: 'Sign up', navMain: 'Main', navSpace: 'My space', navHelp: 'Help',
    profileLoadError: 'Couldn\'t load profile', unverifiedBadge: 'Unverified',
    vitrine: 'Showcase', storeVerify: 'Store verification',
    logoutFailed: 'Could not sign out — check your connection and try again.',
    // Home page (Group D, Round 107) — verbatim js/i18n.en.js unless noted.
    search: 'Search...', searchBtn: 'Search',
    allCategories: 'All categories', wantedOnly: 'Wanted only',
    categoriesNav: 'Categories', // port-added (nav aria-label)
    wilaya: 'Wilaya', allWilayas: 'All wilayas',
    minPrice: 'Min price', maxPrice: 'Max price',
    sortLabel: 'Sort by', sortRecent: 'Most recent',
    sortPriceAsc: 'Price: low to high', sortPriceDesc: 'Price: high to low',
    applyFilters: 'Apply', resetFilters: 'Clear',
    latestAds: 'Latest ads', // port-added (home feed heading)
    feedEmpty: 'No listings right now.', // port-added (home empty state)
    condGood: 'Good',
    loadMoreFailed: 'Could not load more', // port-added (load-more error)
    follow: 'Follow', loginToFollow: 'Log in to follow',
    loginToFavorite: 'Sign in to save this listing to your favorites',
    discoverStore: 'Discover the store',
    wantedBadge: 'Wanted', sold: 'Sold', wholesale: 'Wholesale',
    priceReduced: 'Price reduced', seekerBadge: 'باحث عن عمل', offerBadge: 'عرض عمل',
  },
};

export function getLang(): Lang {
  if (typeof window === 'undefined') return 'ar';
  try {
    const l = localStorage.getItem('dlala_lang');
    if (l === 'fr' || l === 'en' || l === 'ar') return l;
  } catch {
    // ignore
  }
  return 'ar';
}

export function setLangStorage(lang: Lang) {
  try {
    localStorage.setItem('dlala_lang', lang);
  } catch {
    // ignore
  }
}

export function t(key: string, lang: Lang): string {
  return STRINGS[lang][key] || STRINGS.ar[key] || key;
}

// ---------------------------------------------------------------------------
// App-wide language store — ONE language for the whole app.
//
// Bug fixed (Round 106): useLang() used to keep per-component useState, so
// the header's language switcher only re-rendered the header — page content
// (conversations, settings, account, favorites, my-listings, my-follows,
// feed strips, banners…) stayed stuck in its mount language, and pages with
// FR/EN strings but no switcher of their own could never switch at all.
// Legacy js/i18n.js setLang() re-renders the whole page via onLangChange();
// this module-level store + useSyncExternalStore is the React equivalent:
// every mounted useLang() consumer re-renders on every switch, with zero
// call-site changes (all 16 consumers share the API below unchanged).
// ---------------------------------------------------------------------------

let appLang: Lang | null = null; // null = not initialized yet (SSR-safe)
const langListeners = new Set<() => void>();

function readStoredLang(): Lang {
  if (typeof window === 'undefined') return 'ar';
  try {
    const l = window.localStorage.getItem('dlala_lang');
    if (l === 'fr' || l === 'en' || l === 'ar') return l;
  } catch {
    // ignore — corrupted storage keeps the default
  }
  return 'ar';
}

function applyDocLang(l: Lang): void {
  try {
    document.documentElement.lang = l;
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  } catch {
    // a lang/dir attribute must never break rendering
  }
}

function ensureLangInit(): void {
  if (appLang !== null) return;
  appLang = readStoredLang();
  if (typeof window !== 'undefined') {
    try {
      // Cross-tab sync: another tab switched language.
      window.addEventListener('storage', (e: StorageEvent) => {
        if (e.key !== 'dlala_lang') return;
        const v = e.newValue;
        if (v === 'ar' || v === 'fr' || v === 'en') setAppLang(v);
      });
    } catch {
      // ignore
    }
  }
  if (typeof document !== 'undefined') applyDocLang(appLang);
}

/** Current app-wide language (initializes from localStorage on first call). */
export function getAppLang(): Lang {
  ensureLangInit();
  return appLang as Lang;
}

/** Switch the app-wide language: persists to localStorage, updates
 *  <html lang/dir>, and notifies every mounted useLang() consumer
 *  (legacy js/i18n.js onLangChange() re-render parity). */
export function setAppLang(l: Lang): void {
  ensureLangInit();
  if (appLang === l) return;
  appLang = l;
  try {
    window.localStorage.setItem('dlala_lang', l);
  } catch {
    // ignore — persistence is best-effort
  }
  applyDocLang(l);
  langListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // a listener must never break the switch
    }
  });
}

/** Subscribe to app-wide language changes. Returns an unsubscribe function. */
export function subscribeLang(fn: () => void): () => void {
  langListeners.add(fn);
  return () => {
    langListeners.delete(fn);
  };
}

// React hook: app-wide language + setter (legacy js/i18n.js setLang parity).
// All mounted consumers share one state — a switch in the header (or in
// settings, or in the chat thread) re-renders every one of them.
export function useLang(): { lang: Lang; setLang: (l: Lang) => void; t: (k: string) => string } {
  const lang = useSyncExternalStore<Lang>(
    subscribeLang,
    () => getAppLang(),
    () => 'ar', // server snapshot — SSR always renders Arabic
  );
  const setLang = useCallback((l: Lang) => setAppLang(l), []);
  const tr = useCallback((k: string) => t(k, lang), [lang]);
  return { lang, setLang, t: tr };
}
