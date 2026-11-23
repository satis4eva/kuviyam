'use strict';
const { nowIso } = require('./util');
const { hashPassword } = require('./auth');

/** Minimal one-page PDF used as a placeholder receipt for demo data. */
function samplePdf(title) {
  const text = `Sample receipt - demo data: ${title}`.replace(/[()\\]/g, '');
  const stream = `BT /F1 14 Tf 60 760 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const ORGS = [
  { slug: 'vanni-learning-trust', name: 'Vanni Learning Trust', name_ta: 'வன்னி கல்வி அறக்கட்டளை', type: 'Local NGO', country: 'Sri Lanka', place: 'Kilinochchi', cause: 'Education', since: 2019, color: '#0D6B5B',
    about: 'Keeps children in school across the Northern Province with scholarships, uniforms and after-school classes in Tamil and English.',
    about_ta: 'வடமாகாணம் முழுவதும் புலமைப்பரிசில், சீருடை, மாலைநேர வகுப்புகள் மூலம் பிள்ளைகளின் கல்வியைத் தொடரச் செய்கிறது.' },
  { slug: 'uva-hill-schools-fund', name: 'Uva Hill Schools Fund', name_ta: 'ஊவா மலையகப் பாடசாலை நிதியம்', type: 'Registered charity', country: 'Sri Lanka', place: 'Badulla', cause: 'Clean water', since: 2016, color: '#2E6FA8',
    about: 'Brings safe drinking water, toilets and classroom repairs to estate and hill-country Tamil schools.',
    about_ta: 'தோட்டப் பகுதி மற்றும் மலையகத் தமிழ்ப் பாடசாலைகளுக்கு சுத்தமான குடிநீர், கழிப்பறைகள், வகுப்பறைத் திருத்தங்களை வழங்குகிறது.' },
  { slug: 'jaffna-mobile-libraries', name: 'Jaffna Mobile Libraries', name_ta: 'யாழ் நடமாடும் நூலகங்கள்', type: 'Community group', country: 'Sri Lanka', place: 'Jaffna', cause: 'Libraries', since: 2021, color: '#8A4FB0',
    about: 'Runs mobile libraries in Tamil and English for rural and special-needs learners across the peninsula.',
    about_ta: 'குடாநாடு முழுவதும் கிராமப்புற மற்றும் விசேட தேவையுள்ள மாணவர்களுக்கு தமிழ், ஆங்கில நடமாடும் நூலகங்களை நடத்துகிறது.' },
  { slug: 'batticaloa-womens-livelihoods', name: 'Batticaloa Women’s Livelihoods Centre', name_ta: 'மட்டக்களப்பு பெண்கள் வாழ்வாதார மையம்', type: 'Local NGO', country: 'Sri Lanka', place: 'Batticaloa', cause: 'Livelihoods', since: 2018, color: '#B5542D',
    about: 'Small grants and training so mothers can earn and keep their children in school.',
    about_ta: 'தாய்மார்கள் வருமானம் ஈட்டி பிள்ளைகளைப் பாடசாலைக்கு அனுப்ப சிறு நிதியுதவியும் பயிற்சியும் வழங்குகிறது.' },
  { slug: 'trinco-coconut-growers', name: 'Trinco Coconut Growers Collective', name_ta: 'திருமலை தென்னை வளர்ப்போர் கூட்டுறவு', type: 'Community group', country: 'Sri Lanka', place: 'Trincomalee', cause: 'Agriculture', since: 2022, color: '#4C7D2C',
    about: 'Helps small farming families plant and sell coconut, through a revolving fund that is repaid and lent again.',
    about_ta: 'திருப்பிச் செலுத்தி மீண்டும் வழங்கப்படும் சுழற்சி நிதியம் மூலம் சிறு விவசாயக் குடும்பங்கள் தென்னை நட்டு விற்பனை செய்ய உதவுகிறது.' }
];

const PROJECTS = [
  [0, 'Scholarships for 40 O/L students', 'க.பொ.த (சா/த) மாணவர் 40 பேருக்குப் புலமைப்பரிசில்', 'Education', 'Kilinochchi', 6000, 4310, 118, '2027-01-31', 1, 'Monthly stipend £12\nExam fees\nTuition classes', 'மாதாந்த உதவித்தொகை £12\nபரீட்சைக் கட்டணம்\nபிரத்தியேக வகுப்புகள்'],
  [0, 'School bags, uniforms and shoes for 250 children', '250 பிள்ளைகளுக்குப் பாடசாலைப் பை, சீருடை, காலணிகள்', 'Education', 'Mullaitivu', 3500, 1240, 46, '2026-12-20', 1, 'Uniform set £9\nShoes £7\nSchool bag £6', 'சீருடை £9\nகாலணி £7\nபாடசாலைப் பை £6'],
  [1, 'Clean water tank for Haputale Tamil Vidyalaya', 'அப்புத்தளை தமிழ் வித்தியாலயத்துக்குக் குடிநீர்த் தாங்கி', 'Clean water', 'Badulla', 4800, 4520, 203, '2026-12-31', 0, 'Tank and pipes\nFilter unit\nInstallation', 'தாங்கியும் குழாய்களும்\nவடிகட்டி\nபொருத்துதல்'],
  [2, 'A mobile library van for Jaffna villages', 'யாழ் கிராமங்களுக்கு நடமாடும் நூலக வாகனம்', 'Libraries', 'Jaffna', 9000, 3120, 87, '2027-03-15', 0, 'Van conversion\n1,500 books\nDriver for one year', 'வாகன மாற்றியமைப்பு\n1,500 புத்தகங்கள்\nஓராண்டு ஓட்டுநர்'],
  [3, 'Sewing machines for 30 mothers', '30 தாய்மாருக்குத் தையல் இயந்திரங்கள்', 'Livelihoods', 'Batticaloa', 2700, 2060, 64, '2027-01-10', 0, 'Machine £75\nTraining course\nStarter fabric', 'இயந்திரம் £75\nபயிற்சி நெறி\nஆரம்பத் துணி'],
  [4, 'Coconut seedlings for 50 families (revolving fund)', '50 குடும்பங்களுக்குத் தென்னங்கன்றுகள் (சுழற்சி நிதியம்)', 'Agriculture', 'Trincomalee', 2400, 880, 31, '2027-02-01', 1, '20 seedlings per family £30\nFertiliser\nFencing', 'குடும்பத்துக்கு 20 கன்றுகள் £30\nஉரம்\nவேலி'],
  [1, 'Repair the roof at Lunugala school', 'லுனுகலை பாடசாலைக் கூரைத் திருத்தம்', 'Infrastructure', 'Badulla', 5200, 960, 22, '2027-04-30', 0, 'Roof sheets\nLabour\nGutters', 'கூரைத் தகடுகள்\nகூலி\nநீர்வடிகால்கள்'],
  [0, 'Village learning centre in Poonakary', 'பூநகரியில் கிராமக் கற்றல் நிலையம்', 'Infrastructure', 'Kilinochchi', 12000, 5480, 141, '2027-06-30', 0, 'Building works\nDesks and lights\nSolar panels', 'கட்டட வேலைகள்\nமேசைகளும் விளக்குகளும்\nசூரிய மின்தகடுகள்']
];

const STUDENTS = [
  [0, 'Tharshika', 'தர்சிகா', 10, 'Kilinochchi', 'Wants to become a nurse', 'தாதியாக விரும்புகிறாள்', 1500, 0],
  [0, 'Mathujan', 'மதுஜன்', 8, 'Mullaitivu', 'Loves maths and cricket', 'கணிதமும் கிரிக்கெட்டும் பிடிக்கும்', 1200, 0],
  [1, 'Nithya', 'நித்யா', 11, 'Badulla', 'Preparing for O/L exams', 'சா/த பரீட்சைக்குத் தயாராகிறாள்', 1500, 1],
  [2, 'Kajan', 'கஜன்', 6, 'Jaffna', 'Reads every book in the library van', 'நூலக வாகனத்தின் எல்லாப் புத்தகங்களையும் வாசிக்கிறான்', 1000, 0],
  [3, 'Fathima', 'பாத்திமா', 9, 'Batticaloa', 'Wants to study engineering', 'பொறியியல் படிக்க விரும்புகிறாள்', 1500, 0],
  [0, 'Yalini', 'யாழினி', 7, 'Trincomalee', 'Hopes to be a teacher', 'ஆசிரியராக விரும்புகிறாள்', 1200, 0]
];

// [org, month, receivedGBP, status, items: [desc, desc_ta, category, district, lkr]]
const REPORTS = [
  [0, '2026-08', 4250, 'published', [['Scholarship stipends (40 students)', 'புலமைப்பரிசில் உதவித்தொகை (40 மாணவர்)', 'Scholarships', 'Kilinochchi', 184800], ['Tuition teacher fees', 'பிரத்தியேக ஆசிரியர் கட்டணம்', 'Teaching', 'Kilinochchi', 96000], ['Uniform cloth, 120 sets', 'சீருடைத் துணி, 120 தொகுதிகள்', 'School supplies', 'Mullaitivu', 415800], ['Admin and transport', 'நிர்வாகமும் போக்குவரத்தும்', 'Admin', 'Kilinochchi', 23100]]],
  [0, '2026-09', 3700, 'published', [['Scholarship stipends (40 students)', 'புலமைப்பரிசில் உதவித்தொகை (40 மாணவர்)', 'Scholarships', 'Kilinochchi', 184800], ['Tuition teacher fees', 'பிரத்தியேக ஆசிரியர் கட்டணம்', 'Teaching', 'Kilinochchi', 104000], ['Learning centre foundations', 'கற்றல் நிலைய அத்திவாரம்', 'Building', 'Kilinochchi', 577500], ['Bank fees', 'வங்கிக் கட்டணம்', 'Admin', 'Kilinochchi', 9800]]],
  [0, '2026-10', 4610, 'published', [['Scholarship stipends (40 students)', 'புலமைப்பரிசில் உதவித்தொகை (40 மாணவர்)', 'Scholarships', 'Kilinochchi', 184800], ['Shoes, 80 pairs', 'காலணிகள், 80 சோடி', 'School supplies', 'Mullaitivu', 215600], ['Learning centre walls', 'கற்றல் நிலையச் சுவர்கள்', 'Building', 'Kilinochchi', 731500], ['Admin and transport', 'நிர்வாகமும் போக்குவரத்தும்', 'Admin', 'Kilinochchi', 19250]]],
  [1, '2026-10', 5100, 'published', [['Water tank and pipes', 'குடிநீர்த் தாங்கியும் குழாய்களும்', 'Water', 'Badulla', 1270500], ['Plumber labour', 'குழாய் பொருத்துநர் கூலி', 'Water', 'Badulla', 154000], ['Admin', 'நிர்வாகம்', 'Admin', 'Badulla', 30800]]],
  [2, '2026-09', 2300, 'published', [['Van chassis deposit', 'வாகனச் சட்டக முற்பணம்', 'Library', 'Jaffna', 693000], ['Books, first 300', 'முதல் 300 புத்தகங்கள்', 'Library', 'Jaffna', 138600]]],
  [3, '2026-10', 1900, 'published', [['Sewing machines, 8', 'தையல் இயந்திரங்கள், 8', 'Livelihoods', 'Batticaloa', 231000], ['Trainer fees', 'பயிற்றுநர் கட்டணம்', 'Teaching', 'Batticaloa', 77000]]],
  [4, '2026-10', 1100, 'pending', [['Coconut seedlings, 400', 'தென்னங்கன்றுகள், 400', 'Agriculture', 'Trincomalee', 231000]]]
];

function seedDemo(db) {
  const has = db.prepare('SELECT COUNT(*) AS n FROM orgs').get().n;
  if (has > 0) return false;
  const t = nowIso();
  db.exec('BEGIN');
  try {
    const orgIds = ORGS.map((o) => Number(db.prepare(`INSERT INTO orgs (slug, name, name_ta, type, country, place, cause, about, about_ta, status, since, color, contact_email, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?)`).run(o.slug, o.name, o.name_ta, o.type, o.country, o.place, o.cause, o.about, o.about_ta, o.since, o.color, `${o.slug}@example.org`, t).lastInsertRowid));
    for (const p of PROJECTS) {
      db.prepare(`INSERT INTO projects (org_id, title, title_ta, cause, district, goal_pence, raised_pence, donors, ends_on, urgent, needs, needs_ta, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?)`).run(orgIds[p[0]], p[1], p[2], p[3], p[4], p[5] * 100, p[6] * 100, p[7], p[8], p[9], p[10], p[11], t);
    }
    for (const s of STUDENTS) {
      db.prepare(`INSERT INTO students (org_id, name, name_ta, grade, district, dream, dream_ta, monthly_pence, sponsored, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(orgIds[s[0]], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], t);
    }
    for (const r of REPORTS) {
      const rid = Number(db.prepare(`INSERT INTO reports (org_id, month, received_pence, status, submitted_at, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(orgIds[r[0]], r[1], r[2] * 100, r[3], t, r[3] === 'published' ? t : null).lastInsertRowid);
      for (const i of r[4]) {
        const eid = Number(db.prepare(`INSERT INTO expenses (report_id, description, description_ta, category, district, amount_lkr, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(rid, i[0], i[1], i[2], i[3], i[4], t).lastInsertRowid);
        const pdf = samplePdf(i[0]);
        const fid = Number(db.prepare(`INSERT INTO files (owner_kind, owner_id, label, filename, mime, size, data, created_at) VALUES ('expense', ?, 'receipt', ?, 'application/pdf', ?, ?, ?)`)
          .run(eid, `${i[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.pdf`, pdf.length, pdf, t).lastInsertRowid);
        db.prepare('UPDATE expenses SET file_id = ? WHERE id = ?').run(fid, eid);
      }
    }
    // Demo partner account for reviewing the partner dashboard (demo mode only).
    if (process.env.DEMO_PASSWORD) {
      const uid = Number(db.prepare(`INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, 'donor', ?)`)
        .run('partner@demo.kuviyam.org', 'Demo partner (Vanni Learning Trust)', hashPassword(process.env.DEMO_PASSWORD), t).lastInsertRowid);
      db.prepare(`INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'owner')`).run(orgIds[0], uid);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return true;
}

/** Sample community content (feed, events, memorials). Runs once, on any database that has partners but no posts yet. */
function seedCommunity(db) {
  if (db.prepare('SELECT COUNT(*) n FROM posts').get().n > 0) return false;
  const org = (slug) => db.prepare('SELECT id FROM orgs WHERE slug = ?').get(slug);
  const proj = (title) => db.prepare('SELECT id FROM projects WHERE title = ?').get(title);
  const need = ['vanni-learning-trust', 'uva-hill-schools-fund', 'jaffna-mobile-libraries', 'batticaloa-womens-livelihoods', 'trinco-coconut-growers'].map(org);
  if (need.some((x) => !x)) return false;
  const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const day = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  db.exec('BEGIN');
  try {
    const posts = [
      [0, 'Our O/L scholarship students started evening classes this week. Thank you to everyone sponsoring a stipend!', 'எமது சா/த புலமைப்பரிசில் மாணவர்கள் இவ்வாரம் மாலைநேர வகுப்புகளைத் தொடங்கினர். உதவித்தொகை வழங்கும் அனைவருக்கும் நன்றி!', 'Scholarships for 40 O/L students', 2, 84],
      [1, 'The water tank at Haputale is in. Final pipes go in next week.', 'அப்புத்தளையில் குடிநீர்த் தாங்கி பொருத்தப்பட்டது. இறுதிக் குழாய்கள் அடுத்த வாரம்.', 'Clean water tank for Haputale Tamil Vidyalaya', 5, 132],
      [2, 'First test drive of the library van frame. 1,500 books still to go.', 'நூலக வாகனச் சட்டகத்தின் முதல் சோதனை ஓட்டம். இன்னும் 1,500 புத்தகங்கள் தேவை.', 'A mobile library van for Jaffna villages', 26, 57],
      [3, 'Meet the first 12 mothers finishing their sewing course.', 'தையல் பயிற்சியை நிறைவு செய்யும் முதல் 12 தாய்மாரைச் சந்தியுங்கள்.', 'Sewing machines for 30 mothers', 50, 96],
      [4, 'First 200 seedlings planted in Kuchchaveli. Families repay into the fund after the first harvest.', 'குச்சவெளியில் முதல் 200 கன்றுகள் நடப்பட்டன. முதல் அறுவடைக்குப் பின் குடும்பங்கள் நிதியத்துக்குத் திருப்பிச் செலுத்துவர்.', 'Coconut seedlings for 50 families (revolving fund)', 72, 41]
    ];
    for (const [o, text, ta, pt, h, likes] of posts) {
      const p = proj(pt);
      db.prepare(`INSERT INTO posts (org_id, user_id, text, text_ta, project_id, kind, status, likes, created_at) VALUES (?, 0, ?, ?, ?, 'text', 'live', ?, ?)`).run(need[o].id, text, ta, p ? p.id : null, likes, ago(h));
    }
    const events = [
      [0, 'Poonakary learning centre groundbreaking', 'பூநகரி கற்றல் நிலைய அடிக்கல் நாட்டு விழா', 13, 'Poonakary, Kilinochchi', 'பூநகரி, கிளிநொச்சி', 'inperson', null, 46],
      [2, 'London fundraising dinner for the library van', 'நூலக வாகனத்துக்கான லண்டன் நிதி சேகரிப்பு இராப்போசனம்', 20, 'Harrow, London', 'ஹரோ, லண்டன்', 'tickets', '£35', 112],
      [1, 'Volunteer week: paint and repair Lunugala school', 'தன்னார்வ வாரம்: லுனுகலை பாடசாலைக்கு வர்ணம் பூசித் திருத்துதல்', 56, 'Lunugala, Badulla', 'லுனுகலை, பதுளை', 'volunteers', null, 18],
      [4, 'Online: coconut farming Q&A with growers', 'இணையவழி: தென்னை வளர்ப்போருடன் கேள்வி-பதில்', 9, 'Online', 'இணையவழி', 'online', null, 73]
    ];
    for (const [o, title, ta, d, place, placeTa, mode, price, going] of events) {
      db.prepare(`INSERT INTO events (org_id, title, title_ta, starts_on, place, place_ta, mode, price, status, going, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?)`).run(need[o].id, title, ta, day(d), place, placeTa, mode, price, going, ago(1));
    }
    const lib = proj('A mobile library van for Jaffna villages'); const water = proj('Clean water tank for Haputale Tamil Vidyalaya');
    const m1 = Number(db.prepare(`INSERT INTO memorials (user_id, name, name_ta, years, town, town_ta, tribute, tribute_ta, project_id, status, candles, raised_pence, created_at) VALUES (0, ?, ?, '1941 – 2026', ?, ?, ?, ?, ?, 'live', 212, 184000, ?)`)
      .run('Selvanayagam Kandiah', 'செல்வநாயகம் கந்தையா', 'Jaffna and Wembley', 'யாழ்ப்பாணம், வெம்பிளி', 'Retired headmaster who taught three generations in Jaffna. He believed every child deserved a book of their own.', 'யாழ்ப்பாணத்தில் மூன்று தலைமுறைகளுக்குக் கற்பித்த ஓய்வுபெற்ற அதிபர். ஒவ்வொரு பிள்ளைக்கும் சொந்தப் புத்தகம் வேண்டும் என நம்பியவர்.', lib ? lib.id : null, ago(200)).lastInsertRowid);
    db.prepare(`INSERT INTO condolences (memorial_id, user_id, name, body, created_at) VALUES (?, 0, ?, ?, ?)`).run(m1, 'Former student, Toronto', 'You gave me my first English book. Rest in peace, Sir.', ago(150));
    db.prepare(`INSERT INTO condolences (memorial_id, user_id, name, body, created_at) VALUES (?, 0, ?, ?, ?)`).run(m1, 'இராசன் குடும்பம்', 'அம்மாவுக்கும் குடும்பத்தினருக்கும் எமது ஆழ்ந்த இரங்கல்கள்.', ago(120));
    db.prepare(`INSERT INTO memorials (user_id, name, name_ta, years, town, town_ta, tribute, tribute_ta, project_id, status, candles, raised_pence, created_at) VALUES (0, ?, ?, '1950 – 2026', ?, ?, ?, ?, ?, 'live', 88, 62000, ?)`)
      .run('Kamalambigai Sivapalan', 'கமலாம்பிகை சிவபாலன்', 'Vavuniya', 'வவுனியா', 'Nurse, mother of four and the heart of her village. Always the first to help a neighbour.', 'தாதி, நான்கு பிள்ளைகளின் தாய், ஊரின் இதயம். அயலவருக்கு உதவ எப்போதும் முதலில் நிற்பவர்.', water ? water.id : null, ago(330));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return true;
}

/** Demo notice details (dates, places, events, a 31st-day notice). Safe to run on every start. */
function seedNotices(db) {
  db.exec(`INSERT INTO memorial_notices (memorial_id, user_id, type, body, body_ta, status, created_at)
    SELECT m.id, m.user_id, 'obituary', m.tribute, m.tribute_ta, CASE m.status WHEN 'live' THEN 'live' WHEN 'pending' THEN 'pending' ELSE 'rejected' END, m.created_at
    FROM memorials m WHERE NOT EXISTS (SELECT 1 FROM memorial_notices n WHERE n.memorial_id = m.id)`);
  const m = db.prepare(`SELECT * FROM memorials WHERE name = 'Selvanayagam Kandiah' AND user_id = 0`).get();
  if (!m || m.birthplace) return false;
  const day = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  db.prepare(`UPDATE memorials SET born_on = '1941-03-12', died_on = ?, birthplace = 'Karainagar', birthplace_ta = 'காரைநகர்', lived_in = 'Jaffna, Wembley (London)', lived_in_ta = 'யாழ்ப்பாணம், வெம்பிளி (லண்டன்)',
    informed_by = 'Family', contacts = 'Ragu – son – +44 7700 900123\nMalar – daughter – malar@example.com' WHERE id = ?`).run(day(-9), m.id);
  db.prepare(`INSERT INTO memorial_events (memorial_id, kind, on_date, start_time, end_time, venue, address, stream_url) VALUES (?, 'viewing', ?, '16:00', '19:00', 'Harrow Funeral Home', '12 Example Road, Harrow HA1 1AA', NULL)`).run(m.id, day(-6));
  db.prepare(`INSERT INTO memorial_events (memorial_id, kind, on_date, start_time, end_time, venue, address, stream_url) VALUES (?, 'cremation', ?, '11:00', '13:00', 'Breakspear Crematorium', 'Breakspear Road, Ruislip HA4 7SJ', 'https://www.youtube.com/')`).run(m.id, day(-5));
  db.prepare(`INSERT INTO memorial_notices (memorial_id, user_id, type, body, body_ta, status, created_at) VALUES (?, 0, 'r31', ?, ?, 'live', ?)`)
    .run(m.id, 'The family invites relatives and friends to the 31st day remembrance prayers. Thank you for your love and support.', 'அன்னாரின் 31ஆம் நாள் நினைவஞ்சலிப் பிரார்த்தனைக்கு உற்றார், உறவினர், நண்பர்களை அன்புடன் அழைக்கின்றோம். உங்கள் அன்புக்கும் ஆதரவுக்கும் நன்றி.', new Date(Date.now() - 3600e3).toISOString());
  return true;
}

module.exports = { seedDemo, seedCommunity, seedNotices, samplePdf };
