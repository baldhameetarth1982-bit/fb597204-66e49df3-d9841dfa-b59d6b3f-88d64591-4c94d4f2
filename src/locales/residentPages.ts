/** Resident pages: notices, plan paused, contacts, emergency, receipts. [en, hi, gu] */
import type { Catalog } from "./types";

export const residentPages = {
  "rn.subtitle": ["Official updates from your committee", "आपकी कमेटी के आधिकारिक अपडेट", "તમારી કમિટીના સત્તાવાર અપડેટ"],
  "rn.ackDone": ["Thanks — acknowledgement recorded", "धन्यवाद — आपकी पुष्टि दर्ज हो गई", "આભાર — તમારી પુષ્ટિ નોંધાઈ ગઈ"],
  "rn.acknowledged": ["Acknowledged", "पुष्टि की गई", "પુષ્ટિ કરી"],
  "rn.pleaseAck": ["Please acknowledge", "कृपया पुष्टि करें", "કૃપા કરી પુષ્ટિ કરો"],
  "rn.emergencyList": ["Emergency notices", "आपातकालीन नोटिस", "કટોકટીની નોટિસ"],
  "rn.emergencyOn": ["Emergency · {{date}}", "आपातकाल · {{date}}", "કટોકટી · {{date}}"],
  "rn.search": ["Search notices", "नोटिस खोजें", "નોટિસ શોધો"],
  "rn.type": ["Notice type", "नोटिस का प्रकार", "નોટિસનો પ્રકાર"],
  "rn.loadFailed": ["We couldn't load notices.", "नोटिस लोड नहीं हो सके।", "નોટિસ લોડ થઈ શકી નહીં."],
  "rn.noMatch": ["No notices match", "कोई मिलता-जुलता नोटिस नहीं", "કોઈ મેળ ખાતી નોટિસ નથી"],
  "rn.none": ["No notices yet", "अभी कोई नोटिस नहीं", "હજુ કોઈ નોટિસ નથી"],
  "rn.noMatchHint": ["Try another type or search.", "दूसरा प्रकार या खोज आज़माएँ।", "બીજો પ્રકાર અથવા શોધ અજમાવો."],
  "rn.noneHint": ["Your committee hasn't published any notices.", "आपकी कमेटी ने अभी कोई नोटिस नहीं डाला है।", "તમારી કમિટીએ હજુ કોઈ નોટિસ મૂકી નથી."],
  "rn.unreadList": ["Unread notices", "बिना पढ़े नोटिस", "ન વાંચેલી નોટિસ"],
  "rn.earlier": ["Earlier", "पहले के", "પહેલાંની"],
  "rn.earlierList": ["Earlier notices", "पहले के नोटिस", "પહેલાંની નોટિસ"],
  "rn.edited": ["edited", "बदला गया", "બદલાયેલ"],
  "rn.youAcked": ["You acknowledged this notice.", "आपने इस नोटिस की पुष्टि कर दी है।", "તમે આ નોટિસની પુષ્ટિ કરી છે."],
  "rn.iHaveRead": ["I have read this", "मैंने इसे पढ़ लिया है", "મેં આ વાંચી લીધું છે"],
  "rn.visibleUntil": ["Visible until {{date}}", "{{date}} तक दिखेगा", "{{date}} સુધી દેખાશે"],

  "rpr.adminMsg": [
    "Our SociyoHub plan has ended. Please renew it from the committee dashboard so we can use visitors, dues, polls and notices again.",
    "हमारा SociyoHub प्लान खत्म हो गया है। कृपया कमेटी डैशबोर्ड से इसे रिन्यू करें ताकि हम विज़िटर, बकाया, पोल और नोटिस फिर से इस्तेमाल कर सकें।",
    "આપણો SociyoHub પ્લાન પૂરો થઈ ગયો છે. કૃપા કરી કમિટી ડેશબોર્ડ પરથી તેને રિન્યૂ કરો જેથી આપણે વિઝિટર, બાકી રકમ, પોલ અને નોટિસ ફરી વાપરી શકીએ.",
  ],
  "rpr.copied": ["Message copied", "संदेश कॉपी हो गया", "સંદેશ કૉપિ થઈ ગયો"],
  "rpr.copyFailed": ["Couldn't copy", "कॉपी नहीं हो सका", "કૉપિ થઈ શક્યું નહીં"],
  "rpr.paused": ["Society plan paused", "सोसाइटी प्लान रुका हुआ है", "સોસાયટી પ્લાન અટકેલો છે"],
  "rpr.title": ["Your society's plan needs renewing", "आपकी सोसाइटी का प्लान रिन्यू करना है", "તમારી સોસાયટીનો પ્લાન રિન્યૂ કરવાનો છે"],
  "rpr.body": [
    "Only your committee can renew it. Until then, most features are paused for everyone. Nothing has been deleted.",
    "इसे सिर्फ़ आपकी कमेटी रिन्यू कर सकती है। तब तक ज़्यादातर सुविधाएँ सभी के लिए रुकी रहेंगी। कुछ भी डिलीट नहीं हुआ है।",
    "ફક્ત તમારી કમિટી જ તેને રિન્યૂ કરી શકે છે. ત્યાં સુધી મોટાભાગની સુવિધાઓ બધા માટે અટકેલી રહેશે. કંઈ પણ ડિલીટ થયું નથી.",
  ],
  "rpr.step1": ["1. Ask your committee to renew", "1. अपनी कमेटी से रिन्यू करने को कहें", "1. તમારી કમિટીને રિન્યૂ કરવા કહો"],
  "rpr.copy": ["Copy message", "संदेश कॉपी करें", "સંદેશ કૉપિ કરો"],
  "rpr.safe": ["Your data is safe.", "आपका डेटा सुरक्षित है।", "તમારો ડેટા સુરક્ષિત છે."],

  "rc.subtitle": ["Committee members & service providers.", "कमेटी सदस्य और सेवा देने वाले।", "કમિટી સભ્યો અને સેવા આપનારા."],
  "rc.committee": ["Committee", "कमेटी", "કમિટી"],
  "rc.none": ["No contacts published yet.", "अभी कोई संपर्क नहीं डाला गया है।", "હજુ કોઈ સંપર્ક મૂકવામાં આવ્યો નથી."],

  "re.back": ["Back to dashboard", "डैशबोर्ड पर वापस", "ડેશબોર્ડ પર પાછા"],
  "re.title": ["Emergency", "आपातकाल", "કટોકટી"],
  "re.offlineReady": ["Works offline — saved on your device", "बिना इंटरनेट भी चलता है — आपके फ़ोन में सेव है", "ઇન્ટરનેટ વગર પણ ચાલે છે — તમારા ફોનમાં સેવ છે"],
  "re.offline": ["You're offline. Showing cached contacts.", "आप ऑफ़लाइन हैं। सेव किए गए संपर्क दिखा रहे हैं।", "તમે ઑફલાઇન છો. સેવ કરેલા સંપર્કો બતાવી રહ્યા છીએ."],
  "re.inEmergency": ["In an emergency", "आपातकाल में", "કટોકટીમાં"],
  "re.dial": ["Dial 112", "112 डायल करें", "112 ડાયલ કરો"],
  "re.callNow": ["Call now", "अभी कॉल करें", "હમણાં કૉલ કરો"],
  "re.all": ["All numbers", "सभी नंबर", "બધા નંબર"],
  "re.national": ["National", "राष्ट्रीय", "રાષ્ટ્રીય"],

  "rr.subtitle": ["Issued after the committee verifies your payment.", "कमेटी आपका भुगतान जाँचने के बाद जारी होती है।", "કમિટી તમારી ચુકવણી ચકાસે પછી આપવામાં આવે છે."],
} satisfies Catalog;
