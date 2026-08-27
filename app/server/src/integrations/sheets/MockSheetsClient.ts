import { SheetsClient, SheetData } from './SheetsClient.js';

/**
 * Fixture sheet used for dry-run + tests.
 * Matches typical retail / restaurant customer sheet.
 */
export const MOCK_HEADERS = ['Customer Name','Phone','Acquired Date','Rating','Comment','Opt In WhatsApp','Email'];

function daysAgo(n:number): string {
  const d = new Date();
  d.setDate(d.getDate()-n);
  return d.toISOString().split('T')[0];
}

export const MOCK_ROWS: Record<string,string>[] = [
  { 'Customer Name':'Ava Thompson','Phone':'(415) 555-0101','Acquired Date': daysAgo(32),'Rating':'5','Comment':'Absolutely loved it! Will come back','Opt In WhatsApp':'yes','Email':'ava@example.com' },
  { 'Customer Name':'Liam Chen','Phone':'415-555-0102','Acquired Date': daysAgo(31),'Rating':'4','Comment':'Great service, friendly staff','Opt In WhatsApp':'yes','Email':'liam@example.com' },
  { 'Customer Name':'Sophia Patel','Phone':'+1 415 555 0103','Acquired Date': daysAgo(33),'Rating':'2','Comment':'Wait was too long and food was cold','Opt In WhatsApp':'yes','Email':'sophia@example.com' },
  { 'Customer Name':'Noah Kim','Phone':'4155550104','Acquired Date': daysAgo(35),'Rating':'3','Comment':'It was okay, nothing special','Opt In WhatsApp':'no','Email':'noah@example.com' },
  { 'Customer Name':'Isabella Garcia','Phone':'415-555-0105','Acquired Date': daysAgo(10),'Rating':'5','Comment':'Amazing experience!','Opt In WhatsApp':'yes','Email':'isabella@example.com' },
  { 'Customer Name':'Mason Wright','Phone':'415-555-0106','Acquired Date': daysAgo(60),'Rating':'1','Comment':'Terrible, will not return','Opt In WhatsApp':'yes','Email':'mason@example.com' },
  { 'Customer Name':'Emma Johnson','Phone':'415-555-0107','Acquired Date': daysAgo(34),'Rating':'4','Comment':'Nice place, clean and quick','Opt In WhatsApp':'yes','Email':'emma@example.com' },
  { 'Customer Name':'Oliver Brown','Phone':'415-555-0108','Acquired Date': daysAgo(30),'Rating':'5','Comment':'Perfect! Highly recommend','Opt In WhatsApp':'yes','Email':'oliver@example.com' },
  { 'Customer Name':'Charlotte Davis','Phone':'415-555-0109','Acquired Date': daysAgo(31),'Rating':'3','Comment':'Average, could be better','Opt In WhatsApp':'yes','Email':'charlotte@example.com' },
  { 'Customer Name':'Elijah Martinez','Phone':'invalid-phone','Acquired Date': daysAgo(32),'Rating':'4','Comment':'Good value','Opt In WhatsApp':'yes','Email':'elijah@example.com' },
  { 'Customer Name':'Amelia Wilson','Phone':'415-555-0111','Acquired Date':'not-a-date','Rating':'5','Comment':'Love it!','Opt In WhatsApp':'yes','Email':'amelia@example.com' },
  { 'Customer Name':'James Anderson','Phone':'415-555-0112','Acquired Date': daysAgo(36),'Rating':'2','Comment':'Disappointed with service','Opt In WhatsApp':'','Email':'james@example.com' },
  { 'Customer Name':'Harper Thomas','Phone':'415-555-0113','Acquired Date': daysAgo(32),'Rating':'5','Comment':'','Opt In WhatsApp':'yes','Email':'harper@example.com' },
  { 'Customer Name':'Benjamin Lee','Phone':'415-555-0114','Acquired Date': daysAgo(33),'Rating':'4','Comment':'Will recommend to friends','Opt In WhatsApp':'yes','Email':'ben@example.com' },
  { 'Customer Name':'Evelyn Harris','Phone':'415-555-0115','Acquired Date': daysAgo(29),'Rating':'5','Comment':'Fantastic, loved everything','Opt In WhatsApp':'yes','Email':'evelyn@example.com' },
];

export class MockSheetsClient implements SheetsClient {
  async fetchSheet(_url: string): Promise<SheetData> {
    // ignore URL, return fixture; but if url contains "empty" simulate empty
    if (_url.includes('empty')) {
      return { title: 'Empty Sheet', headers: MOCK_HEADERS, rows: [], rawRows: [MOCK_HEADERS] };
    }
    // if url contains "weird-headers" return synonyms test
    if (_url.includes('weird')) {
      const weirdHeaders = ['full name','mobile','signup','stars','review','consent','mail'];
      const weirdRows = MOCK_ROWS.slice(0,3).map(r=> ({
        'full name': r['Customer Name'],
        'mobile': r['Phone'],
        'signup': r['Acquired Date'],
        'stars': r['Rating'],
        'review': r['Comment'],
        'consent': r['Opt In WhatsApp'],
        'mail': r['Email'],
      }));
      return { title: 'Weird Headers Fixture', headers: weirdHeaders, rows: weirdRows as any, rawRows: [weirdHeaders, ...weirdRows.map(r=>Object.values(r))] };
    }
    return {
      title: 'Demo Customers (Mock)',
      headers: MOCK_HEADERS,
      rows: MOCK_ROWS,
      rawRows: [MOCK_HEADERS, ...MOCK_ROWS.map(r=> MOCK_HEADERS.map(h=> r[h] ?? ''))],
    };
  }
  async testConnection(_url: string): Promise<{ ok: boolean; title?: string; error?: string }> {
    return { ok: true, title: 'Demo Customers (Mock)' };
  }
}
