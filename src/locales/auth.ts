/** Sign-in, sign-up, phone OTP and password reset strings. [en, hi, gu] */
import type { Catalog } from "./types";

export const auth = {
  "auth.back": ["Back", "वापस", "પાછા"],
  "auth.title.welcome": ["Welcome to SociyoHub", "SociyoHub में आपका स्वागत है", "SociyoHub માં આપનું સ્વાગત છે"],
  "auth.title.emailSignIn": ["Sign in with email", "ईमेल से साइन इन करें", "ઈમેલથી સાઇન ઇન કરો"],
  "auth.title.createAccount": ["Create your account", "अपना खाता बनाएँ", "તમારું ખાતું બનાવો"],
  "auth.title.phone": ["Continue with phone", "फ़ोन से जारी रखें", "ફોનથી ચાલુ રાખો"],
  "auth.tagline": ["Society management, simplified.", "सोसाइटी प्रबंधन, आसान।", "સોસાયટી વ્યવસ્થાપન, સરળ."],
  "auth.limited.title": ["Please wait before trying again", "फिर से कोशिश करने से पहले कृपया रुकें", "ફરી પ્રયાસ કરતાં પહેલાં કૃપા કરીને રાહ જુઓ"],
  "auth.limited.temporary": ["This limit is temporary.", "यह सीमा अस्थायी है।", "આ મર્યાદા કામચલાઉ છે."],
  "auth.continueGoogle": ["Continue with Google", "Google से जारी रखें", "Google થી ચાલુ રાખો"],
  "auth.continuePhone": ["Continue with Phone", "फ़ोन से जारी रखें", "ફોનથી ચાલુ રાખો"],
  "auth.continueEmail": ["Continue with Email", "ईमेल से जारी रखें", "ઈમેલથી ચાલુ રાખો"],
  "auth.verifySignIn": ["Verify & sign in", "सत्यापित करें और साइन इन करें", "ચકાસો અને સાઇન ઇન કરો"],
  "auth.autoCreate": [
    "We'll create your account automatically if this is your first time.",
    "अगर आप पहली बार आए हैं तो हम आपका खाता अपने-आप बना देंगे।",
    "જો તમે પહેલી વાર આવ્યા હો તો અમે તમારું ખાતું આપમેળે બનાવીશું.",
  ],
  "auth.fullName": ["Full name", "पूरा नाम", "પૂરું નામ"],
  "auth.yourName": ["Your name", "आपका नाम", "તમારું નામ"],
  "auth.email": ["Email", "ईमेल", "ઈમેલ"],
  "auth.password": ["Password", "पासवर्ड", "પાસવર્ડ"],
  "auth.signIn": ["Sign in", "साइन इन करें", "સાઇન ઇન કરો"],
  "auth.createAccount": ["Create account", "खाता बनाएँ", "ખાતું બનાવો"],
  "auth.forgot": ["Forgot password?", "पासवर्ड भूल गए?", "પાસવર્ડ ભૂલી ગયા?"],
  "auth.toSignUp": ["New here? Create an account", "नए हैं? खाता बनाएँ", "નવા છો? ખાતું બનાવો"],
  "auth.toSignIn": ["Already have an account? Sign in", "पहले से खाता है? साइन इन करें", "પહેલેથી ખાતું છે? સાઇન ઇન કરો"],
  "auth.safe.title": ["Your data is safe with SociyoHub", "आपका डेटा SociyoHub के साथ सुरक्षित है", "તમારો ડેટા SociyoHub સાથે સુરક્ષિત છે"],
  "auth.safe.checked": [
    "Sign-in attempts are checked before they proceed",
    "साइन-इन प्रयास आगे बढ़ने से पहले जाँचे जाते हैं",
    "સાઇન-ઇન પ્રયાસો આગળ વધે તે પહેલાં તપાસાય છે",
  ],
  "auth.safe.role": [
    "Access follows your assigned society role",
    "पहुँच आपकी सौंपी गई सोसाइटी भूमिका के अनुसार है",
    "ઍક્સેસ તમને સોંપાયેલી સોસાયટી ભૂમિકા મુજબ છે",
  ],
  "auth.terms": ["Terms", "शर्तें", "શરતો"],
  "auth.privacy": ["Privacy", "गोपनीयता", "ગોપનીયતા"],
  "auth.toast.created": [
    "Account created. Check your email if confirmation is required.",
    "खाता बन गया। पुष्टि ज़रूरी हो तो अपना ईमेल देखें।",
    "ખાતું બની ગયું. પુષ્ટિ જરૂરી હોય તો તમારો ઈમેલ તપાસો.",
  ],
  "auth.toast.createFailed": ["Couldn't create the account. Please try again.", "खाता नहीं बन सका। कृपया फिर से कोशिश करें।", "ખાતું બની શક્યું નથી. કૃપા કરીને ફરી પ્રયાસ કરો."],
  "auth.toast.signInFailed": ["Couldn't sign in. Please try again.", "साइन इन नहीं हो सका। कृपया फिर से कोशिश करें।", "સાઇન ઇન થઈ શક્યું નથી. કૃપા કરીને ફરી પ્રયાસ કરો."],
  "auth.toast.enterEmailFirst": [
    "Enter your email above first, then tap Forgot password.",
    "पहले ऊपर अपना ईमेल दर्ज करें, फिर 'पासवर्ड भूल गए' दबाएँ।",
    "પહેલાં ઉપર તમારો ઈમેલ લખો, પછી 'પાસવર્ડ ભૂલી ગયા' દબાવો.",
  ],
  "auth.toast.resetSent": [
    "If an account exists for this email, a reset link is on its way.",
    "अगर इस ईमेल का खाता है, तो रीसेट लिंक भेजा जा रहा है।",
    "જો આ ઈમેલનું ખાતું હશે, તો રીસેટ લિંક મોકલાઈ રહી છે.",
  ],
  "auth.toast.resetFailed": ["Couldn't send the reset email. Please try again.", "रीसेट ईमेल नहीं भेजा जा सका। कृपया फिर से कोशिश करें।", "રીસેટ ઈમેલ મોકલી શકાયો નથી. કૃપા કરીને ફરી પ્રયાસ કરો."],
  "auth.toast.unreachable": [
    "Couldn't reach SociyoHub. Check your connection and try again.",
    "SociyoHub से संपर्क नहीं हो सका। कनेक्शन जाँचें और फिर से कोशिश करें।",
    "SociyoHub સુધી પહોંચી શકાયું નથી. કનેક્શન તપાસો અને ફરી પ્રયાસ કરો.",
  ],
  "auth.toast.googleFailed": ["Google sign-in failed. Please try again.", "Google साइन-इन विफल रहा। कृपया फिर से कोशिश करें।", "Google સાઇન-ઇન નિષ્ફળ રહ્યું. કૃપા કરીને ફરી પ્રયાસ કરો."],
  "auth.toast.truecallerUnavailable": ["Truecaller sign-in unavailable", "Truecaller साइन-इन उपलब्ध नहीं है", "Truecaller સાઇન-ઇન ઉપલબ્ધ નથી"],
  "auth.toast.couldNotSignIn": ["Could not sign in", "साइन इन नहीं हो सका", "સાઇન ઇન થઈ શક્યું નથી"],
  "auth.toast.signedIn": ["Signed in", "साइन इन हो गया", "સાઇન ઇન થઈ ગયું"],

  // Phone OTP
  "otp.mobile": ["Mobile number", "मोबाइल नंबर", "મોબાઇલ નંબર"],
  "otp.hint": [
    "Include country code. We'll text you a 6-digit code.",
    "देश कोड शामिल करें। हम आपको 6 अंकों का कोड भेजेंगे।",
    "દેશ કોડ સાથે લખો. અમે તમને 6 અંકનો કોડ મોકલીશું.",
  ],
  "otp.send": ["Send code", "कोड भेजें", "કોડ મોકલો"],
  "otp.enter": ["Enter code", "कोड दर्ज करें", "કોડ લખો"],
  "otp.sentTo": ["Sent to {{phone}}", "{{phone}} पर भेजा गया", "{{phone}} પર મોકલાયો"],
  "otp.verify": ["Verify", "सत्यापित करें", "ચકાસો"],
  "otp.change": ["Change number", "नंबर बदलें", "નંબર બદલો"],
  "otp.sent": ["Code sent", "कोड भेज दिया गया", "કોડ મોકલાયો"],
  "otp.sendFailed": ["Could not send the code. Please try again.", "कोड नहीं भेजा जा सका। कृपया फिर से कोशिश करें।", "કોડ મોકલી શકાયો નથી. કૃપા કરીને ફરી પ્રયાસ કરો."],
  "otp.wrong": ["That code didn't work. Check it and try again.", "वह कोड काम नहीं किया। जाँचकर फिर से कोशिश करें।", "તે કોડ ચાલ્યો નહીં. તપાસીને ફરી પ્રયાસ કરો."],
  "otp.linkFailed": ["Could not link phone", "फ़ोन जोड़ा नहीं जा सका", "ફોન જોડી શકાયો નથી"],

  // Password visibility
  "password.show": ["Show {{what}}", "{{what}} दिखाएँ", "{{what}} બતાવો"],
  "password.hide": ["Hide {{what}}", "{{what}} छिपाएँ", "{{what}} છુપાવો"],
  "password.what": ["password", "पासवर्ड", "પાસવર્ડ"],

  // Reset password
  "reset.title": ["Choose a new password", "नया पासवर्ड चुनें", "નવો પાસવર્ડ પસંદ કરો"],
  "reset.checking": [
    "Open this page from the reset link in your email. Checking your link…",
    "यह पेज अपने ईमेल के रीसेट लिंक से खोलें। आपका लिंक जाँचा जा रहा है…",
    "આ પેજ તમારા ઈમેલની રીસેટ લિંકથી ખોલો. તમારી લિંક તપાસાઈ રહી છે…",
  ],
  "reset.new": ["New password", "नया पासवर्ड", "નવો પાસવર્ડ"],
  "reset.confirm": ["Confirm password", "पासवर्ड की पुष्टि करें", "પાસવર્ડની પુષ્ટિ કરો"],
  "reset.save": ["Save password", "पासवर्ड सहेजें", "પાસવર્ડ સાચવો"],
  "reset.tooShort": ["Use at least 6 characters.", "कम से कम 6 अक्षर उपयोग करें।", "ઓછામાં ઓછા 6 અક્ષર વાપરો."],
  "reset.mismatch": ["The two passwords don't match.", "दोनों पासवर्ड मेल नहीं खाते।", "બંને પાસવર્ડ મેળ ખાતા નથી."],
  "reset.failed": [
    "Couldn't update the password. Open the link from your email again.",
    "पासवर्ड अपडेट नहीं हो सका। ईमेल से लिंक फिर से खोलें।",
    "પાસવર્ડ અપડેટ થઈ શક્યો નથી. ઈમેલમાંથી લિંક ફરી ખોલો.",
  ],
  "reset.done": ["Password updated.", "पासवर्ड अपडेट हो गया।", "પાસવર્ડ અપડેટ થઈ ગયો."],

  // Sign out
  "signout.title": ["Sign out?", "साइन आउट करें?", "સાઇન આઉટ કરવું છે?"],
  "signout.body": [
    "You'll need to sign in again to use SociyoHub on this device.",
    "इस डिवाइस पर SociyoHub उपयोग करने के लिए आपको फिर से साइन इन करना होगा।",
    "આ ઉપકરણ પર SociyoHub વાપરવા માટે તમારે ફરી સાઇન ઇન કરવું પડશે.",
  ],
  "signout.stay": ["Stay signed in", "साइन इन रहें", "સાઇન ઇન રહો"],
} satisfies Catalog;
