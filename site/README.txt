תיקיית הפריסה ל-Netlify
========================

קבצים בתיקייה זו מוגשים כשורש האתר:

  index.html         ← הדשבורד (עותק של climate_dashboard.html)
  climate_data.xlsx  ← *להוסיף ידנית* — קובץ הנתונים שלך (מומלץ מדולל)

איך מייצרים את climate_data.xlsx המדולל:
  1. פתחו את הדשבורד מקומית ב-Chrome/Edge עם הקובץ המלא מחובר (📂 חבר קובץ Excel).
  2. לחצו "🌐 קובץ לאתר" — יורד climate_data.xlsx מדולל (גיליונות המפה הכבדים מדוללים).
  3. הניחו את הקובץ שהורד כאן, ליד index.html.

אם לא מניחים climate_data.xlsx — האתר עדיין עובד על נתוני ברירת המחדל המוטמעים.

הערה: index.html הוא עותק של climate_dashboard.html שבשורש המאגר. אם עורכים את
הדשבורד, יש להעתיק מחדש:  cp climate_dashboard.html site/index.html
