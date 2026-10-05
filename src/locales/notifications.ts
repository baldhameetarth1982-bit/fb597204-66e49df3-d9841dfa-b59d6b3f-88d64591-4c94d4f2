/** Notification centre strings. [en, hi, gu] */
import type { Catalog } from "./types";

export const notifications = {
  "notif.title": ["Notifications", "सूचनाएँ", "સૂચનાઓ"],
  "notif.subtitle": [
    "Notices, bills, visitors, requests and parking",
    "सूचनाएँ, बिल, आगंतुक, अनुरोध और पार्किंग",
    "સૂચનાઓ, બિલ, મુલાકાતીઓ, વિનંતીઓ અને પાર્કિંગ",
  ],
  "notif.unreadCount_one": ["{{count}} unread", "{{count}} अपठित", "{{count}} ન વાંચેલ"],
  "notif.unreadCount_other": ["{{count}} unread", "{{count}} अपठित", "{{count}} ન વાંચેલ"],
  "notif.markAll": ["Mark all read", "सभी को पढ़ा हुआ करें", "બધાને વાંચેલ કરો"],
  "notif.searchLabel": ["Search notifications", "सूचनाएँ खोजें", "સૂચનાઓ શોધો"],
  "notif.searchPlaceholder": ["Search notifications…", "सूचनाएँ खोजें…", "સૂચનાઓ શોધો…"],
  "notif.typeLabel": ["Notification type", "सूचना का प्रकार", "સૂચનાનો પ્રકાર"],
  "notif.tab.all": ["All", "सभी", "બધી"],
  "notif.tab.notices": ["Notices", "नोटिस", "નોટિસ"],
  "notif.tab.billing": ["Bills", "बिल", "બિલ"],
  "notif.tab.visitors": ["Visitors", "आगंतुक", "મુલાકાતીઓ"],
  "notif.tab.helpdesk": ["Requests", "अनुरोध", "વિનંતીઓ"],
  "notif.tab.parking": ["Parking", "पार्किंग", "પાર્કિંગ"],
  "notif.partial": [
    "Some updates couldn't load, so this list may be incomplete.",
    "कुछ अपडेट लोड नहीं हो सके, इसलिए यह सूची अधूरी हो सकती है।",
    "કેટલાક અપડેટ લોડ થયા નથી, તેથી આ યાદી અધૂરી હોઈ શકે.",
  ],
  "notif.caughtUp": ["You're all caught up", "सब देख लिया गया है", "બધું જોઈ લીધું છે"],
  "notif.emptyBody": ["New notices and updates will show here.", "नई सूचनाएँ और अपडेट यहाँ दिखेंगे।", "નવી સૂચનાઓ અને અપડેટ અહીં દેખાશે."],
  "notif.attention": ["Needs your attention", "आपका ध्यान चाहिए", "તમારું ધ્યાન જરૂરી"],
  "notif.urgent": ["Urgent", "अत्यावश्यक", "તાત્કાલિક"],
  "notif.important": ["Important", "महत्वपूर्ण", "મહત્વપૂર્ણ"],
  "notif.noticeSuffix": ["{{category}} notice", "{{category}} सूचना", "{{category}} નોટિસ"],
  "notif.billPaid": ["Bill paid", "बिल का भुगतान हुआ", "બિલ ચૂકવાયું"],
  "notif.newBill": ["New maintenance bill", "नया मेंटेनेंस बिल", "નવું મેન્ટેનન્સ બિલ"],
  "notif.bill": ["Bill", "बिल", "બિલ"],
  "notif.due": ["due {{date}}", "देय {{date}}", "બાકી તારીખ {{date}}"],
} satisfies Catalog;
