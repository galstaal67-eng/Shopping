# דשבורד סיכוני אקלים — מסמך העברה (עדכון 2026-06-01)

מסמך זה מסכם את מצב הפרויקט להמשך פיתוח **בסשן חדש (כולל ב-claude.ai web)**. הוא מחליף את גרסת ההעברה הקודמת ומשקף את כל מה שנבנה עד כה.

> **מה לצרף לסשן החדש:** הקובץ `climate_dashboard.html` (הקובץ הראשי), המסמך הזה, ואם רלוונטי גם `climate_data.xlsx`.

---

## 0. הבדלים חשובים בעבודה ב-web (claude.ai) מול Claude Code

- ב-web אין גישה למערכת הקבצים המקומית ואין הרצת PowerShell/שרת. Claude לא יוכל לשמור אוטומטית ל-Excel שלך או להריץ שרת מקומי.
- דרך עבודה מומלצת ב-web: להעלות את `climate_dashboard.html`, לבקש שינויים, ולקבל קובץ מעודכן/Artifact. בדיקה ויזואלית נעשית דרך תצוגת ה-Artifact או בדפדפן שלך.
- **המודל לא משתנה:** קובץ HTML יחיד ↔ `climate_data.xlsx` דרך File System Access API. אין framework, אין build.
- אין `node`/`python` בסביבה המקומית — אימות JS נעשה ע"י טעינת ה-HTML בדפדפן ובדיקת הקונסול (לא ע"י `node`).

---

## 1. סקירה כללית

דשבורד אינטראקטיבי לניתוח סיכוני אקלים של חברות ציבוריות בישראל (בעיקר נדל"ן ובנייה, וגם ענפים נוספים). מציג סיכון אקלים ברמת חברה/ענף/תיק, מצב מים ומשקעים, **שכבות הצפה ארציות (תמ"א 1/7)**, רגולציה, וניתוח תיק השקעות.

**קובץ ראשי:** `climate_dashboard.html` — קובץ HTML יחיד עם `<script>` פנימי גדול (≈7,300 שורות). כל הלוגיקה, ה-CSS וה-HTML באותו קובץ.

**מקור הנתונים:** `climate_data.xlsx` מקומי, מתחבר דרך **File System Access API** (קריאה+כתיבה). הדשבורד טוען בהתחברות ושומר אוטומטית (debounced) על כל שינוי. בנוסף, **טאב ההצפות מושך נתונים חיים מ-ArcGIS** (ראו §8).

---

## 2. מחסנית טכנולוגית

- **Vanilla JS** (ללא framework). תבנית: `state` גלובלי → `render()` בונה מחדש את `#root.innerHTML` → `attachEvents()` מחבר מאזינים.
- **Leaflet 1.9.4** (CDN) — מפות (אקלים, מים, חברה, **הצפות**). Fallback ל-SVG אם Leaflet לא נטען.
- **SheetJS / XLSX 0.18.5** (CDN) — קריאה/כתיבה Excel, ייצוא דוחות, ופענוח CSV.
- **RTL מלא, עברית.** מזהי קוד באנגלית; טקסטים בעברית.
- דורש דפדפן עם File System Access API (Chrome/Edge). חיבור אינטרנט נדרש ל-CDN ולטאב ההצפות.

---

## 3. ארכיטקטורה (לולאת render)

- `render()` (~3548): מנקה Leaflet ישן, בונה מחדש `renderHeader() + renderActiveTab() + renderFooter()`, קורא `attachEvents()`, ובסוף מאתחל מפות לפי הטאב הפעיל (climate / water / **floods** / company).
- `renderActiveTab()` — switch לפי `state.activeTab`.
- **מאזינים:** או inline `onclick`/`oninput` לפונקציות גלובליות, או `data-*` המחוברים ב-`attachEvents()`.
- **מפות Leaflet** הן "self-healing": כל אתחול מסיר מפה קודמת ובונה מחדש (גלובלים `_climateMap`, `_waterMap`, `_floodMap`, וכן `state._leafletMap` למפת החברה).

---

## 4. אינטגרציית Excel (`climate_data.xlsx`)

### כלל קריטי לשמירה
`xlSaveNow` (~839) **קורא קודם את החוברת הקיימת** ומחליף רק את הגיליונות המנוהלים — כל גיליון אחר (כולל "נקודות"/"Streams" של המשתמש) **נשמר**. אסור לבנות חוברת מאפס.

### גיליונות מנוהלים
חברות, תרחישים, השפעה ענפית, חשיפת חברות, **מוכנות חברות**, _meta.

### ⚠️ עדכון חשוב — מוכנות חברות (קטגוריות מותאמות-אישית)
בעבר השמירה/טעינה השתמשו ברשימת 7 הקטגוריות הקבועות (`PREP_CATS_IDS`). **תוקן:** עכשיו `xlSaveNow` ו-`xlLoad` עוברים על `PREP_CATEGORIES` (הרשימה החיה), כך ש**קטגוריות מוכנות מותאמות-אישית** (שנוספות דרך מודול 3) נשמרות ונטענות (round-trip). בטעינה, עמודות בגיליון "מוכנות חברות" שאינן ברירת-מחדל ואינן "המלצה:" מזוהות אוטומטית כקטגוריות חדשות ומתווספות ל-`PREP_CATEGORIES`. עזר: `prepLabelFor(cat)`.

### הרשאות כתיבה
`xlConnect` מבקש `readwrite`. אם שמירה אוטומטית נכשלת ("User activation required") — מוצג כפתור "שמור עכשיו" (`xlSaveManual`).

---

## 5. מבנה ה-state (עיקרי)

```
state = {
  activeTab: 'overview' | 'companies_overview' | 'portfolio' | 'scenarios' | 'sectors' | 'companies',
  overviewMode: 'climate' | 'water' | 'floods',   // ← נוסף 'floods'
  coOverviewMode: 'market' | 'company',
  stressFactor: 1,        // ← נוסף: מבחן עקה. מכפיל חומרת תרחיש (1=בסיס … 2=+100%)
  scenarios, sectorImpact, exposure, portfolio, ...
}
```

**פונקציות חישוב מרכזיות:**
- `sectorScenarioScore(sid, sector)` — ציון ענף×תרחיש (impact×importance, 0–5). **כאן מוחל `stressFactor`** (מקור-אמת יחיד → מתפשט לכל המודל).
- `companyScenarioScore(co, sid)`, `rawRisk(co)`, `finalRisk(co)`, `companyPrepScore(co)`, `mapScoreColor(v)`.
- ⚠️ אין פונקציה בשם `avgPrep` — להשתמש ב-`companyPrepScore(company)`.

---

## 6. מפת טאבים ותכונות

### 📊 סקירה כללית (`renderOverview`) — 3 תת-טאבים
- **🌍 מצב אקלים** (`renderOverviewClimate`): מפת נקודות Leaflet עם שכבות (כולל שיטפון), דוחות שמ"ט, ניתוח מגמות, וחלון רגולציה.
- **💧 מים ומשקעים** (`renderWaterStatus`): מפת מקורות מים, KPI, ניתוח סיכון. דאטה: `WATER_FEATURES`.
- **🌊 הצפות (תמ"א 1/7)** (`renderFloodsStatus`) — **חדש**. ראו §8. כולל גם **סינון לפי סטטוס תכנית** (סיידבר), **שכבת נכסי חברות** על המפה, ופאנל **הצלבת נכסי חברות מול פשטי הצפה** (§9.10–11).

### 🏢 סקירת חברות (`renderCompaniesOverview`)
- **📊 תצוגת שוק** (`renderOverviewMarket`): פילטרים, **🧪 סליידר מבחן עקה** (חדש), KPI, גרף בועות סיכון-מול-הון-עצמי, גרף בועות ענפי, מפת חום ענף×תרחיש. הגוף המתעדכן הופרד ל-`renderMarketBody()` (מתרענן חי בעת גרירת הסליידר).
- **🏢 פרופיל חברה** (`renderOverviewCompany`): בחירת חברה, גmauge, ראדר חשיפה לתרחישים, **ראדר מוכנות מול ממוצע ענף** (חדש, `renderPrepRadar`) + טבלת פערים, benchmark, המלצת מדרג, מפת נכסים.

### 💼 ניתוח תיק (`renderPortfolio`)
העלאת Excel/CSV → התאמה → תמונת מצב. הגוף הופרד ל-`renderPortfolioBody()`. כולל **🧪 סליידר מבחן עקה ברמת תיק** (חדש), **📥 ייצוא Excel** ו-**🖨️ דוח PDF** (חדש). ראו §7.

### 🌍/🏭/🏢 מודול 1/2/3
עריכת תרחישים, מטריצת השפעה ענפית, וחברות (כולל חלון מוכנות עם המלצת מדרג והוספת/הסרת קטגוריות מוכנות).

---

## 7. מנוע ומודול התיק

- `handlePortfolioFile` → `pfSheetToRows(ws)` (זיהוי חכם של שורת הכותרות) → `ingestPortfolio(rows)`.
- אינדקסים: `byIssuer/byTicker` (מדויק) + `byIssuerD/byTickerD` (ספרות-בלבד). סדר התאמה: מנפיק → נייר → הצלבה → שם.
- **תיקון באג (קריטי):** `ingestPortfolio` קרא ל-`avgPrep()` שאינו קיים → **כל העלאת תיק נכשלה** ("avgPrep is not defined"). תוקן ל-`companyPrepScore(co)`.
- **CSV עברי (חדש):** `decodeCsvBytes()` מזהה UTF-8 (כולל BOM) ונופל ל-Windows-1255 אם מזוהה תו החלפה. קבצי `.csv` מפוענחים לטקסט לפני XLSX.read; קבצי `.xlsx` כרגיל.
- **מבחן עקה בתיק:** `renderPortfolioBody()` מחשב מחדש `m.raw/m.fin` בכל רינדור (קוראים `stressFactor`), כך שסיכון התיק/KPI/התפלגויות/פרופיל תרחישים מגיבים לסליידר חי.
- **ייצוא:** `pfExportXlsx()` — חוברת רב-גיליונות (סיכום / חברות בתיק כולל ציוני תרחיש / פיזור ענפי / פרופיל תרחישים / לא-הותאמו), הורדה דרך Blob. `pfPrintReport()` — דוח חד-עמודי בחלון נפרד מותאם להדפסה/PDF.

---

## 8. טאב ההצפות — נתונים חיים מ-ArcGIS (חדש)

מקור: **מפת "פשטי הצפה תמ"א 1/7" של משרד החקלאות** (אושרה 02/2026).

- **Feature Service:** `https://services3.arcgis.com/Fqk0gVrfcnumlR5m/arcgis/rest/services/Flood_Plains/FeatureServer`
- **קישורים:** מידע פתוח — `https://data1-moag.opendata.arcgis.com/maps/61b18f3b2b88455f88e119ae3232f7cb/about` ; מפה מקורית (appid) — `97277b057e424fefa169385245101561`.
- **שכבות** (`FLOOD_LAYERS`): 4=פשט הצפה (פוליגון ארצי יחיד), 5=שטח הצפה (66), 3=פשט הצפה לגריעה מותנית, 2=נחלים (778, קו), 0=אתרי ויסות נגר (130, נקודה), 1=אתרי ויסות נגר שטח (71, פוליגון). ברירת מחדל דולקות: 4,5,2.

**איך זה עובד (חי, לא מוטמע):**
- `initFloodsMap()` בונה Leaflet (self-healing), ועל `moveend` קורא `floodReload()`.
- `floodFetchAndDraw(cfg)` שולח שאילתת `query` עם תיבת התצוגה (`esriGeometryEnvelope`, `inSR/outSR=4326`), `f=geojson`, ו-`maxAllowableOffset` נגזר מהזום (`floodOffsetDeg`) להכללה ולביצועים. השירות תומך CORS ו-GeoJSON.
- מנגנון seq (`_floodReqSeq`) מתעלם מתשובות ישנות; `_floodInFlight` מנהל אינדיקטור טעינה (`#flood-loading`); כשל מציג `#flood-error` + קישור למקור.
- `floodToggleLayer(id)` מדליק/מכבה שכבה (אם נטענה כבר — re-add, אחרת fetch).
- **חיזוק:** ב-`initFloodsMap` יש `invalidateSize()` לפני המשיכה הראשונה — אחרת מפה בגודל 0 מחזירה `getBounds` ריק ולא נטענים נתונים.

**אומת בדפדפן:** עם מפה בגודל תקין נטענו כל הנתונים מהמקור (130/778/66 + פשטי הצפה) בהתאמה לסכומי השירות; 0 שגיאות קונסול.

---

## 9. Changelog של הסשן (2026-06-01)

1. **קידום גרסה:** `climate_dashboard_fixed.html` (מה-zip) הפך לקובץ הראשי; הישן גובה כ-`climate_dashboard.bak_20260530.html`.
2. **🧪 מבחן עקה** — בתצוגת שוק וגם בניתוח תיק. סליידר 0%→+100% מעדכן KPI/מפת חום/בועות/סיכון תיק בזמן אמת. מחוון גלובלי בכותרת + באנר + איפוס. מומש ב-`sectorScenarioScore`.
3. **ראדר מוכנות מול ענף** — בפרופיל חברה (`renderPrepRadar`) + טבלת פערים.
4. **ייצוא תיק** — `pfExportXlsx` (Excel רב-גיליונות) + `pfPrintReport` (דוח PDF).
5. **תיקון באג קריטי** — `avgPrep` → `companyPrepScore` (העלאת תיק עבדה שוב).
6. **קליטת CSV עברי** — `decodeCsvBytes` (UTF-8/Windows-1255).
7. **קטגוריות מוכנות מותאמות-אישית** — נשמרות/נטענות מ-Excel (round-trip מלא).
8. **טאב הצפות (תמ"א 1/7)** — נתונים חיים מ-ArcGIS, 6 שכבות, מקרא, קישורי מקור.
9. **ניקוי** — הסרת משתנה `changelog` מת מפרופיל החברה.

### עדכון המשך (2026-06-01, סשן web)

10. **🏢 הצלבת נכסי חברות מול פשטי הצפה** — פאנל חדש בטאב ההצפות (מתחת למפה). כפתור "חשב סיכון הצפה לנכסים" מריץ שאילתות מרחביות חיות (`returnCountOnly`) מול ArcGIS לכל עיר שבה ממוקמים נכסי חברה (~5 ק״מ סביב מרכז העיר), ומדרג כל חברה: **גבוהה** (נכס בתחום פשט/שטח הצפה), **בינונית** (קרבת נחל), **נמוכה**. מציג KPI + טבלה ממוינת + דגל "מטה חשוף". בנוסף — שכבת overlay **🏢 נכסי חברות** על המפה (כפתור בשורת השכבות) שמציגה את כל הנכסים, צבועים לפי חשיפה לאחר החישוב. פונקציות: `floodAnalyzeCompanies`, `floodComputeCompanies`, `floodAssetLevel`, `floodCountUrl`, `floodCoPanelHtml`, `floodRenderCoPanel`, `floodToggleAssets`, `floodDrawAssets`. מקור-אמת: `_floodCoState`. *(שודרג מאוחר יותר לדיוק לפי קואורדינטות — §9.14.)*
11. **🔎 סינון טאב הצפות לפי סטטוס תכנית** — רצועת צ'יפים בסיידבר (שדה `STATUS` מהנתונים). הצ'יפים מתגלים דינמית תוך כדי טעינת השכבות (`floodSyncStatusUI`). כיבוי/הדלקה מצייר מחדש מתוך GeoJSON שמור **ללא משיכה חוזרת** (`floodRedraw`, `floodBuildLayer`, `_floodRaw`). מצב: `_floodStatusOff`, עזרים `floodFeaturePasses`/`floodStatusKey`.
12. **📊 ראדר מוכנות בדוח ה-PDF** — `pfPrintReport` כולל כעת סעיף "מוכנות התיק לפי קטגוריה — מול ממוצע השוק": ראדר SVG (מוכנות התיק המשוקללת מול ממוצע כלל המאגר) + טבלת פערים. פונקציה: `pfPrepRadarSVG(matched)` (משתמשת ב-`PREP_CATEGORIES` החי ו-`prepLabelFor`).

### עדכון המשך — קואורדינטות אמת + שילוב במודל (2026-06-01)

13. **📍 קואורדינטות נכסים אמיתיות (גיליון "נכסים")** — מודל הנכסים שודרג: לכל נכס יש `lat/lng`. נכסי דמו מקבלים קואורדינטה נגזרת-עיר (דטרמיניסטית), ונכסי **אמת** נטענים מגיליון Excel מנוהל חדש בשם **"נכסים"** (עמודות: `ticker`, `שם חברה`, `סוג מיקום` [מקומי/חו"ל], `סוג נכס`, `עיר / מיקום`, `קו רוחב`, `קו אורך`, `תיאור`). round-trip מלא: `xlSaveNow` כותב את הגיליון (רק אם קיים או אחרי "ייצא/סנכרן"), `xlLoad` קורא ומחליף נכסים per-ticker (tickers שלא בגיליון שומרים דמו). כפתור **📤 ייצא/סנכרן נכסים** (`xlExportAssets`) יוצר תבנית לעריכה. עזרים: `assetCoord(asset)` (precise אם `real`), `xlAssetRows`, `ASSET_TYPE_BY_LABEL`. כל הצרכנים (מפת החברה `renderLeafletMap`, שכבת הנכסים, הצלבת ההצפה) מעדיפים `lat/lng`.
14. **🌊 הצלבת נכסים — דיוק לפי קואורדינטות** — `floodAnalyzeCompanies` שודרג: שאילתה **לכל נכס** (לא רק עיר), עם איחוד מיקומים (`floodCollectAssetLocs`/`floodLocKey`) והגבלת מקביליות (`floodRunJobs`, 8 במקביל). נכס אמת נבדק ב-~150 מ׳ (`d=0.0015`), נכס דמו בקירוב עיר ~5 ק״מ (`d=0.045`). הוחלף `floodCityLevel`→`floodAssetLevel(asset)`; `byCity`→`byKey`. הפאנל מציין כמה חברות נותחו עם קואורדינטות אמת.
15. **⚖️ שילוב חשיפת הצפה במודל הסיכון (toggle)** — `state.includeFloodInRisk` (ברירת מחדל כבוי). כשמופעל (checkbox בפאנל ההצפות, רק אחרי חישוב) — `finalRisk` מקבל תוספת `floodRiskAdj(company)`: **+0.5** לחשיפה גבוהה, **+0.25** לבינונית (תקרה 5). מקור-אמת יחיד → מתפשט לכל הדשבורד (KPI/רשימות/תיק/דוחות). מחוון גלובלי בכותרת (`renderHeader`) עם כפתור "כבה". מפה: `_floodCoState.byTicker`. החלפה: `floodToggleRiskModel`.

---

## 10. נושאים פתוחים / TODO

- **למלא נתונים בגיליון "חברות":** `מספר מנפיק` (התאמת תיק מדויקת), `הון עצמי` ו-`שווי שוק` (גרף הבועות). משימת דאטה של המשתמש.
- ~~**ראדר מוכנות בדוח/ייצוא**~~ — ✅ נוסף לדוח ה-PDF (§9.12).
- ~~**טאב הצפות: סינון לפי סטטוס + הצלבת נכסי חברות**~~ — ✅ שניהם מומשו (§9.10–11).
- ~~**דיוק הצלבת נכסים + חיבור ל-`finalRisk`**~~ — ✅ קואורדינטות אמת מ-Excel (§9.13–14) + toggle שילוב במודל (§9.15).
- **למלא קואורדינטות אמת בגיליון "נכסים":** כרגע רוב הנכסים בנתוני דמו. להזנת מיקומי אמת: 📤 ייצא/סנכרן נכסים → מלא `קו רוחב`/`קו אורך` ב-Excel → התחבר מחדש. משימת דאטה של המשתמש.
- **עריכת נכסים בתוך האפליקציה:** כיום העריכה דרך Excel בלבד (תואם מודל "Excel = מקור-אמת"). אפשר להוסיף UI עריכה ישיר (הוספת/מחיקת נכס, גרירה על המפה) בעתיד.
- **כיול תוספת ה-`floodRiskAdj`:** הערכים (+0.5/+0.25) הם הנחת-עבודה; כדאי לכייל מול נתוני אמת/מתודולוגיה.
- **ביצועים:** `climate_data.xlsx` תפח ל-~60MB (נתוני מפה רבים) — לשקול דילול גיליונות כבדים אם הטעינה/שמירה איטית. הוספת ~2,300 שורות נכסים זניחה.
- **קואורדינטות/CRS:** שירות ArcGIS עובד ב-Web Mercator; השאילתות מבקשות `outSR=4326` ולכן ה-GeoJSON תקין ל-Leaflet.
- ניקוי קוד מת מינורי נוסף.

---

## 11. מוסכמות עריכה ובדיקה

- **לערוך את `climate_dashboard.html` במקום** (קובץ יחיד). ב-web — לעדכן את הקובץ/Artifact ולמסור חזרה.
- **בדיקת תקינות JS:** לטעון את ה-HTML בדפדפן (Chrome/Edge), Ctrl+F5, ולוודא בקונסול שאין שגיאות; לעבור בין הטאבים. (אין `node` מקומי.)
- **לא לבנות חוברת Excel מאפס** — לשמר גיליונות לא-מנוהלים.
- **מפות Leaflet חדשות** — תבנית self-healing + `invalidateSize` לפני שימוש ב-`getBounds`.
- **טאב הצפות דורש אינטרנט** — לטפל בכשל רשת בחן (הודעת שגיאה + קישור למקור).

---

## 12. מפת מיקומים מהירה (שמות פונקציות)

| תחום | פונקציות |
|------|----------|
| ליבה | `render`, `renderHeader`, `renderActiveTab`, `attachEvents`, `state` |
| Excel | `xlConnect`, `xlLoad`, `xlSaveNow`, `xlScheduleSave`, `xlSaveManual`, `prepLabelFor` |
| נכסים | `initCompanyAssets`, `assetCoord`, `xlAssetRows`, `xlExportAssets`, `ASSET_TYPES`, `ASSET_TYPE_BY_LABEL`, גיליון "נכסים" |
| חישוב | `sectorScenarioScore` (←stressFactor), `companyScenarioScore`, `rawRisk`, `finalRisk` (←`floodRiskAdj`), `companyPrepScore`, `mapScoreColor` |
| הצפה במודל | `floodRiskAdj`, `floodToggleRiskModel`, `state.includeFloodInRisk`, `_floodCoState.byTicker` |
| מבחן עקה | `renderStressControl(target)`, `stressOnInput(el,target)`, `stressOnChange`, `stressReset`, `renderMarketBody`, `marketUsedSet` |
| סקירה/אקלים | `renderOverview`, `renderOverviewClimate`, `initClimateMap` |
| מים | `renderWaterStatus`, `initWaterMap`, `waterToggleLayer`, `WATER_FEATURES` |
| **הצפות** | `renderFloodsStatus`, `initFloodsMap`, `floodFetchAndDraw`, `floodReload`, `floodToggleLayer`, `floodQueryUrl`, `floodOffsetDeg`, `floodPopup`, `FLOOD_LAYERS`, `FLOOD_SERVICE` |
| **הצפות — סינון סטטוס** | `floodBuildLayer`, `floodRedraw`, `floodToggleStatus`, `floodStatusFilterHtml`, `floodSyncStatusUI`, `floodFeaturePasses`, `floodStatusKey`, `_floodRaw`, `_floodStatusOff`, `_floodStatuses` |
| **הצפות — נכסי חברות** | `floodAnalyzeCompanies`, `floodComputeCompanies`, `floodAssetLevel`, `floodCollectAssetLocs`, `floodLocKey`, `floodRunJobs`, `floodCountUrl`, `floodCoPanelHtml`, `floodRenderCoPanel`, `floodToggleAssets`, `floodDrawAssets`, `FLOOD_CO_LAYERS`, `_floodCoState` |
| חברות | `renderOverviewMarket`, `renderOverviewCompany`, `renderRadar`, `renderPrepRadar`, `sectorPrepAvg`, `prepValForCat`, `renderChart_HeatmapSecScen` |
| תיק | `renderPortfolio`, `renderPortfolioBody`, `handlePortfolioFile`, `decodeCsvBytes`, `pfSheetToRows`, `ingestPortfolio`, `pfExportXlsx`, `pfPrintReport`, `pfPrepRadarSVG`, `pfClear` |
| מוכנות | `PREP_CATEGORIES`, `PREP_CATS_IDS`, `prepLabelFor`, `suggestRec`, `setRecommendation` |

---

*קובץ עצמאי. להמשך ב-web: להעלות את `climate_dashboard.html` + מסמך זה, ולהמשיך מ-§10 (TODO).*
