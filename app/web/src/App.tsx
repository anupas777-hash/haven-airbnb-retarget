import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Onboarding, MappingConfirm } from '@/features/onboarding/Onboarding';
import { Audience } from '@/features/audience/Audience';
import { Composer } from '@/features/composer/Composer';
import { Review } from '@/features/review/Review';
import { CohortPanel, CohortRule } from '@/features/cohort/Cohort';
import { Button, Badge, Stepper, Card, Chip } from '@/components/ui';

const qc = new QueryClient();

function Shell() {
  const [step, setStep] = useState<number>(1);
  const [sourceId, setSourceId] = useState<string | null>(() => localStorage.getItem('sourceId'));
  const [needsMapping, setNeedsMapping] = useState(false);
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(() => localStorage.getItem('campaignId'));
  const [selectionCount, setSelectionCount] = useState(0);
  const [cohortRule, setCohortRule] = useState<CohortRule>({ type: 'customRange' });
  const [activePane, setActivePane] = useState<'campaign' | 'sources' | 'templates' | 'settings'>('campaign');
  const [search, setSearch] = useState('');
  const [minRating, setMinRating] = useState<number | undefined>(undefined);
  const [maxRating, setMaxRating] = useState<number | undefined>(undefined);
  const [sentiment, setSentiment] = useState<string[]>([]);
  const [manualQuery, setManualQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [selectedMap, setSelectedMap] = useState<Map<string, any>>(new Map());
  const qcClient = useQueryClient();

  const { data: setup } = useQuery({ queryKey: ['setup'], queryFn: () => api.setupStatus(), refetchInterval: 10000 });
  const { data: campaign } = useQuery({ queryKey: ['campaign', campaignId], queryFn: () => api.getCampaign(campaignId!), enabled: !!campaignId });
  const { data: sources } = useQuery({ queryKey: ['sources'], queryFn: () => api.getSources() });
  const { data: templates } = useQuery({ queryKey: ['templates'], queryFn: () => api.templates() });

  useEffect(() => {
    if (!sources) return;
    if (sourceId) {
      const exists = sources.find((s: any) => s.id === sourceId);
      if (!exists) {
        if (sources.length > 0) {
          const first = sources[0];
          setSourceId(first.id);
          localStorage.setItem('sourceId', first.id);
          setCampaignId(null);
          localStorage.removeItem('campaignId');
        } else {
          setSourceId(null);
          localStorage.removeItem('sourceId');
          setCampaignId(null);
          localStorage.removeItem('campaignId');
        }
      }
    } else if (sources.length > 0) {
      const first = sources[0];
      setSourceId(first.id);
      localStorage.setItem('sourceId', first.id);
    }
  }, [sources]);

  useEffect(() => {
    if (sourceId && !campaignId) {
      (async () => {
        const c = await api.createCampaign({ cohortRule, discountPercent: 10, name: `Stay for ${new Date().toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}` });
        setCampaignId(c.id);
        localStorage.setItem('campaignId', c.id);
        localStorage.setItem('sourceId', sourceId);
        setStep(2);
        setActivePane('campaign');
      })();
    }
  }, [sourceId, campaignId]);

  async function handleCohortChange(nr: CohortRule) {
    setCohortRule(nr);
    if (campaignId) {
      await api.patchCampaign(campaignId, { cohortRule: nr });
      qcClient.invalidateQueries({ queryKey: ['customers'] });
      qcClient.invalidateQueries({ queryKey: ['customers-define'] });
    }
  }

  useEffect(() => {
    const h = () => {
      setActivePane('campaign');
      setStep(1);
    };
    window.addEventListener('go-define' as any, h);
    return () => window.removeEventListener('go-define' as any, h);
  }, []);

  const { data: defineCustomers } = useQuery({
    queryKey: ['customers-define', search, minRating, maxRating, sentiment, campaignId],
    queryFn: () =>
      api.customers({
        search: search || undefined,
        minRating,
        maxRating,
        sentiment: sentiment.length ? sentiment.join(',') : undefined,
        page: 1,
        pageSize: 1,
        campaignId: campaignId || undefined,
      }),
    enabled: !!campaignId,
  });
  const defineTotal = defineCustomers?.total ?? 0;

  const { data: manualDataDefine } = useQuery({
    queryKey: ['customers-manual-define', manualQuery],
    queryFn: () => api.customers({ search: manualQuery, pageSize: 5, from: '1970-01-01', to: '2100-01-01' }),
    enabled: manualQuery.length >= 2,
  });
  const manualResultsDefine = manualDataDefine?.items || [];

  function toggleSentiment(s: string) {
    setSentiment((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }
  function handleManualAdd(c: any) {
    if (selectAllMatching) return;
    if (!c.phoneValid) {
      alert(`${c.name} needs a valid phone to be added.`);
      return;
    }
    if (selectedIds.has(c.id)) return;
    const ns = new Set(selectedIds);
    ns.add(c.id);
    const nm = new Map(selectedMap);
    nm.set(c.id, c);
    setSelectedIds(ns);
    setSelectedMap(nm);
    setManualQuery('');
  }
  function removeManual(id: string) {
    const ns = new Set(selectedIds);
    ns.delete(id);
    const nm = new Map(selectedMap);
    nm.delete(id);
    setSelectedIds(ns);
    setSelectedMap(nm);
  }
  const selectedCountDerived = selectAllMatching ? defineTotal - deselected.size : selectedIds.size;
  useEffect(() => {
    setSelectionCount(selectedCountDerived);
  }, [selectedCountDerived]);

  async function handleSync() {
    if (!sourceId) return;
    try {
      const res = await api.sync({ sourceId });
      if (res.needsConfirmation) {
        setPendingSourceId(res.sourceId);
        setNeedsMapping(true);
      } else {
        qcClient.invalidateQueries({ queryKey: ['customers'] });
        qcClient.invalidateQueries({ queryKey: ['sources'] });
      }
      return res;
    } catch (e: any) {
      alert(e.message || 'Sync failed');
    }
  }

  if (!sourceId || needsMapping) {
    if (needsMapping && (pendingSourceId || sourceId)) {
      const sid = pendingSourceId || sourceId!;
      return (
        <div className="min-h-screen bg-surface">
          <div className="max-w-[720px] mx-auto px-6 py-12">
            <MappingConfirm
              sourceId={sid}
              onConfirmed={async () => {
                setNeedsMapping(false);
                setPendingSourceId(null);
                qcClient.invalidateQueries({ queryKey: ['customers'] });
                qcClient.invalidateQueries({ queryKey: ['sources'] });
                setStep(2);
                setActivePane('campaign');
              }}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-surface">
        <div className="max-w-[640px] mx-auto px-6 py-12">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-fog bg-white px-3 py-1 text-xs text-stone">Haven · Airbnb stays</div>
            <h1 className="display text-4xl font-semibold tracking-tight mt-4">Bring past guests back</h1>
            <p className="text-stone mt-2 max-w-[520px] mx-auto">Paste your guest sheet. We map the columns, score every review, and surface past guests for a personal WhatsApp note.</p>
          </div>
          <Onboarding
            onDone={async (sid, needs) => {
              setSourceId(sid);
              localStorage.setItem('sourceId', sid);
              if (needs) {
                setPendingSourceId(sid);
                setNeedsMapping(true);
              } else {
                setStep(2);
              }
              qcClient.invalidateQueries({ queryKey: ['sources'] });
              qcClient.invalidateQueries({ queryKey: ['customers'] });
            }}
          />
        </div>
      </div>
    );
  }

  const steps = ['Define', 'Audience', 'Compose', 'Review'];
  const stepperCurrent = Math.max(0, Math.min(3, step - 1));

  return (
    <div className="min-h-screen bg-surface flex">
      <aside className="w-[260px] shrink-0 bg-white border-r border-fog flex flex-col sticky top-0 h-screen">
        <div className="h-16 px-6 flex items-center gap-3 border-b border-fog">
          <div className="w-8 h-8 rounded-lg bg-ink text-white grid place-items-center font-semibold text-sm">H</div>
          <div>
            <div className="font-semibold leading-none">Haven</div>
            <div className="text-xs text-stone">Airbnb · Portfolio</div>
          </div>
          <Badge className="ml-auto bg-accent text-white border-accent text-xs">Live</Badge>
        </div>

        <nav className="p-4 space-y-6 flex-1 overflow-auto">
          <div>
            <div className="text-xs font-medium text-stone px-2 mb-2">Campaign</div>
            <div className="space-y-1">
              <button onClick={() => { setActivePane('campaign'); setStep(1); }} className={`w-full text-left px-3 py-2 rounded-xl text-sm flex items-center justify-between ${step===1 && activePane==='campaign' ? 'bg-ink text-white' : 'hover:bg-surface text-stone hover:text-ink'}`}>
                <span>Define</span>
                <span className="text-xs opacity-60">{defineTotal}</span>
              </button>
              <button onClick={() => { setActivePane('campaign'); setStep(2); }} className={`w-full text-left px-3 py-2 rounded-xl text-sm flex items-center justify-between ${step===2 && activePane==='campaign' ? 'bg-ink text-white' : 'hover:bg-surface'}`}>
                <span>Audience</span>
                {selectionCount ? <span className="bg-accent text-white text-xs px-2 py-0.5 rounded-full">{selectionCount}</span> : null}
              </button>
              <button onClick={() => { setActivePane('campaign'); setStep(3); }} className={`w-full text-left px-3 py-2 rounded-xl text-sm ${step===3 && activePane==='campaign' ? 'bg-ink text-white' : 'hover:bg-surface'}`}>Compose</button>
              <button onClick={() => { setActivePane('campaign'); setStep(4); }} className={`w-full text-left px-3 py-2 rounded-xl text-sm ${step===4 && activePane==='campaign' ? 'bg-ink text-white' : 'hover:bg-surface'}`}>Review</button>
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-stone px-2 mb-2">Workspace</div>
            <div className="space-y-1">
              <button onClick={() => setActivePane('sources')} className={`w-full text-left px-3 py-2 rounded-xl text-sm ${activePane==='sources' ? 'bg-ink text-white' : 'hover:bg-surface'}`}>Sources · {sources?.length ?? 0}</button>
              <button onClick={() => setActivePane('templates')} className={`w-full text-left px-3 py-2 rounded-xl text-sm ${activePane==='templates' ? 'bg-ink text-white' : 'hover:bg-surface'}`}>Templates · {templates?.length ?? 0}</button>
              <button onClick={() => setActivePane('settings')} className={`w-full text-left px-3 py-2 rounded-xl text-sm ${activePane==='settings' ? 'bg-ink text-white' : 'hover:bg-surface'}`}>Settings</button>
            </div>
          </div>
        </nav>

        <div className="p-4 border-t border-fog space-y-3">
          <div className="rounded-xl bg-surface border border-fog p-3">
            <div className="text-xs font-medium">{sources?.find((s:any)=>s.id===sourceId)?.title || '-'}</div>
            <div className="text-xs text-stone truncate">{sourceId?.slice(0,18)}</div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <Button variant="outline" size="sm" onClick={handleSync} className="rounded-full">Sync</Button>
              <Button variant="ghost" size="sm" onClick={() => { localStorage.removeItem('sourceId'); localStorage.removeItem('campaignId'); setSourceId(null); setCampaignId(null); }}>Switch</Button>
            </div>
          </div>
          <div className="text-xs text-stone px-1">Brand · {setup?.brandName || 'Haven'}</div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {setup?.mode === 'dry-run' && activePane==='campaign' && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-sm px-6 py-2.5 flex items-center justify-center gap-2">
            <Badge className="bg-white border-amber-200 text-amber-800">Proof</Badge>
            <span>Proof run - messages are simulated. <button onClick={()=>setActivePane('settings')} className="underline font-medium">Go live</button> to post real WhatsApp.</span>
          </div>
        )}

        {activePane==='campaign' && (
          <div className="h-16 px-6 md:px-8 flex items-center justify-between border-b border-fog bg-white/80 backdrop-blur sticky top-0 z-10">
            <Stepper steps={steps} current={stepperCurrent} />
            <div className="hidden md:flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={step<=1} onClick={()=>setStep(s=>Math.max(1,s-1))} className="rounded-full">Back</Button>
              <Button size="sm" disabled={step>=4} onClick={()=>setStep(s=>Math.min(4,s+1))} className="rounded-full">Next</Button>
            </div>
          </div>
        )}

        <div className="flex-1 p-6 md:p-8 bg-surface overflow-auto">
          <div className="max-w-[1200px] mx-auto">
            {activePane==='sources' ? <SourcesPane /> : activePane==='templates' ? <TemplatesPane /> : activePane==='settings' ? <GoLiveWizard onClose={()=>setActivePane('campaign')} /> : step===1 ? (
              <div className="max-w-[880px] mx-auto space-y-6">
                <div>
                  <h1 className="display text-3xl font-semibold tracking-tight">Define your group</h1>
                  <p className="text-stone mt-1">Set dates and sift the ledger. The audience in the next step reflects this.</p>
                </div>

                <Card className="p-6">
                  <h3 className="font-medium">Date range</h3>
                  <p className="text-sm text-stone mt-1">Filter by first stay. Leave empty to include all time.</p>
                  <div className="mt-4">
                    <CohortPanel value={cohortRule} onChange={handleCohortChange} />
                  </div>
                  {campaign && <div className="mt-4 text-xs text-stone flex gap-2"><Badge className="bg-surface border-fog">{campaign.name}</Badge><Badge className="bg-surface border-fog">{campaign.discountPercent}% · {campaign.status}</Badge><Badge className="bg-surface border-fog">{defineTotal} in group</Badge></div>}
                </Card>

                <div className="grid md:grid-cols-2 gap-6">
                  <Card className="p-6">
                    <h3 className="font-medium">Filter</h3>
                    <div className="mt-4 space-y-4">
                      <input placeholder="Search name, review, phone" value={search} onChange={e=>setSearch(e.target.value)} className="flex h-9 w-full rounded-full border border-fog bg-white px-4 text-sm" />
                      <div>
                        <div className="text-xs font-medium text-stone mb-2">Stars</div>
                        <div className="flex gap-2">
                          {[1,2,3,4,5].map(n=>(
                            <button key={n} onClick={()=>setMinRating(minRating===n?undefined:n)} className={`w-9 h-9 rounded-full border text-sm ${minRating===n?'bg-ink text-white border-ink':'bg-white border-fog hover:bg-surface'}`}>{n}</button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 mt-3 text-xs">
                          <span>min</span>
                          <select value={minRating??''} onChange={e=>setMinRating(e.target.value?parseInt(e.target.value):undefined)} className="border border-fog rounded-full px-3 py-1 bg-white"><option value="">any</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
                          <span>max</span>
                          <select value={maxRating??''} onChange={e=>setMaxRating(e.target.value?parseInt(e.target.value):undefined)} className="border border-fog rounded-full px-3 py-1 bg-white"><option value="">any</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-stone mb-2">Tone</div>
                        <div className="flex gap-2 flex-wrap">
                          <Chip active={sentiment.includes('positive')} onClick={()=>toggleSentiment('positive')}>Positive</Chip>
                          <Chip active={sentiment.includes('neutral')} onClick={()=>toggleSentiment('neutral')}>Neutral</Chip>
                          <Chip active={sentiment.includes('negative')} onClick={()=>toggleSentiment('negative')}>Negative</Chip>
                        </div>
                      </div>
                      {(search || minRating || maxRating || sentiment.length) && <Button variant="ghost" size="sm" onClick={()=>{setSearch('');setMinRating(undefined);setMaxRating(undefined);setSentiment([]);}} className="rounded-full">Clear</Button>}
                      <div className="pt-3 border-t border-fog text-sm"><span className="font-medium">{defineTotal}</span> <span className="text-stone">matching</span></div>
                    </div>
                  </Card>

                  <Card className="p-6">
                    <h3 className="font-medium">Hand-pick</h3>
                    <p className="text-xs text-stone mt-1">Add anyone beyond filters. Each gets the same message.</p>
                    <div className="relative mt-4">
                      <input placeholder="Search name, email, phone…" value={manualQuery} onChange={e=>setManualQuery(e.target.value)} disabled={selectAllMatching} className="flex h-9 w-full rounded-full border border-fog bg-white px-4 text-sm disabled:opacity-50" />
                      {manualQuery.length>=2 && manualResultsDefine.length>0 && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-fog rounded-xl shadow-lift z-10 max-h-60 overflow-auto">
                          {manualResultsDefine.map((c:any)=>{
                            const excluded = !c.phoneValid;
                            const already = selectedIds.has(c.id);
                            return (
                              <button key={c.id} onClick={()=>handleManualAdd(c)} disabled={excluded||already} className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-surface ${excluded?'opacity-50':''} ${already?'bg-surface':''}`}>
                                <span><span className="font-medium">{c.name}</span> <span className="text-xs text-stone">{c.phoneE164?`••••${c.phoneE164.slice(-4)}`:c.phoneRaw}</span></span>
                                <span className="text-xs">{already?'✓':excluded?'-':'+ Add'}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {!selectAllMatching && selectedIds.size>0 && (
                      <div className="mt-4 pt-4 border-t border-fog">
                        <div className="text-xs font-medium text-stone">Set · {selectedIds.size}</div>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {Array.from(selectedMap.values()).map((c:any)=>(
                            <span key={c.id} className="inline-flex items-center gap-1 bg-ink text-white text-xs rounded-full px-3 py-1">{c.name}<button onClick={()=>removeManual(c.id)} className="ml-1">×</button></span>
                          ))}
                        </div>
                        <Button variant="ghost" size="sm" onClick={()=>{setSelectedIds(new Set());setSelectedMap(new Map());}} className="rounded-full mt-3">Clear set</Button>
                      </div>
                    )}
                    {selectAllMatching && <div className="mt-4 text-xs text-stone">✓ All {defineTotal} matching</div>}
                  </Card>
                </div>

                <div className="flex justify-end">
                  <Button onClick={()=>setStep(2)} className="rounded-full">Open audience →</Button>
                </div>
              </div>
            ) : step===2 ? (
              <Audience
                campaignId={campaignId}
                sourceId={sourceId}
                search={search}
                minRating={minRating}
                maxRating={maxRating}
                sentiment={sentiment}
                selectedIds={selectedIds}
                selectAllMatching={selectAllMatching}
                deselected={deselected}
                selectedMap={selectedMap}
                onSelectionChange={setSelectionCount}
                onContinue={()=>setStep(3)}
                onToggleRow={(id,excluded,obj)=>{
                  if(excluded) return;
                  if(selectAllMatching){ const nd=new Set(deselected); if(nd.has(id)) nd.delete(id); else nd.add(id); setDeselected(nd); } else { const ns=new Set(selectedIds); const nm=new Map(selectedMap); if(ns.has(id)){ns.delete(id);nm.delete(id);} else {ns.add(id); if(obj) nm.set(id,obj);} setSelectedIds(ns); setSelectedMap(nm); }
                }}
                onSelectAllPage={(ids,objs)=>{
                  if(selectAllMatching) return;
                  const allSelected=ids.every(id=>selectedIds.has(id));
                  const ns=new Set(selectedIds); const nm=new Map(selectedMap);
                  if(allSelected) ids.forEach(id=>{ns.delete(id);nm.delete(id);}); else ids.forEach((id,i)=>{ns.add(id); if(objs[i]) nm.set(id,objs[i]);});
                  setSelectedIds(ns); setSelectedMap(nm);
                }}
                onSelectAllMatching={()=>{
                  setSelectAllMatching(v=>!v);
                  setSelectedIds(new Set());
                  setDeselected(new Set());
                  setSelectedMap(new Map());
                }}
              />
            ) : step===3 ? (
              campaignId ? <Composer campaignId={campaignId} onNext={()=>setStep(4)} exampleGuest={selectedMap.size>0?Array.from(selectedMap.values())[0]:undefined} /> : <div className="text-center text-stone">Define your group first.</div>
            ) : step===4 ? (
              campaignId ? <Review campaignId={campaignId} /> : <div>No campaign</div>
            ) : <div>Unknown</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function SourcesPane() {
  const { data: sources, refetch } = useQuery({ queryKey: ['sources'], queryFn: () => api.getSources() });
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  async function handleAdd() {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await api.ingest(url);
      setResult(res);
      qc.invalidateQueries({ queryKey: ['sources'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      refetch();
      if (res.needsConfirmation) setError('Needs mapping - open Define to confirm.');
    } catch (e:any) { setError(e.message); } finally { setLoading(false); }
  }
  async function handleSync(id:string) {
    try {
      const res = await api.sync({ sourceId: id });
      setResult(res);
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['sources'] });
    } catch (e:any) { setError(e.message); }
  }
  return (
    <div className="max-w-[720px] mx-auto space-y-6">
      <div>
        <h1 className="display text-2xl font-semibold">Sources</h1>
        <p className="text-stone text-sm mt-1">Public link-viewer sheets work instantly. Private sheets need Settings share.</p>
      </div>
      <Card className="p-6">
        <h3 className="font-medium">Add ledger</h3>
        <div className="flex gap-2 mt-3">
          <input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/.../edit" className="flex-1 h-9 rounded-full border border-fog bg-white px-4 text-sm" />
          <Button onClick={handleAdd} disabled={loading||!url} className="rounded-full">{loading?'Ingesting…':'Add & sync'}</Button>
        </div>
        {result && !result.needsConfirmation && <div className="mt-3 text-sm bg-emerald-50 border border-emerald-200 rounded-xl p-3">Ingested · {result.added} added · {result.updated} updated · {result.title}</div>}
        {error && <div className="mt-3 text-sm text-signal bg-red-50 border border-red-200 rounded-xl p-3">{error}</div>}
      </Card>
      <div className="space-y-3">
        {sources?.map((s:any)=>(
          <Card key={s.id} className="p-4 flex items-center justify-between">
            <div className="min-w-0">
              <div className="font-medium truncate">{s.title}</div>
              <div className="text-xs text-stone truncate">{s.url}</div>
              <div className="text-xs text-stone">Last sync {s.lastSyncedAt?new Date(s.lastSyncedAt).toLocaleString():'never'}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={()=>handleSync(s.id)} className="rounded-full">Sync</Button>
              <Button size="sm" onClick={()=>{localStorage.setItem('sourceId',s.id);localStorage.removeItem('campaignId');location.reload();}} className="rounded-full">Use</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function TemplatesPane() {
  const { data: templates, refetch } = useQuery({ queryKey: ['templates'], queryFn: () => api.templates() });
  const [name, setName] = useState('');
  const [body, setBody] = useState('Hi {{name}} - we miss you at {{brand}}! Here’s {{discount}} off your next stay. Reply YES.');
  const [wpName, setWpName] = useState('reengagement_offer');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function handleCreate() {
    setSaving(true); setError(null);
    try {
      if(!name||!body) throw new Error('Name and body required');
      await api.createTemplate({ name, body, whatsappTemplateName: wpName||null, locale:'en_US', variables:[{key:'1',mappedTo:'name'},{key:'2',mappedTo:'discount'},{key:'3',mappedTo:'brand'}]});
      setName(''); refetch();
    } catch(e:any){ setError(e.message);} finally{setSaving(false);}
  }
  return (
    <div className="max-w-[720px] mx-auto space-y-6">
      <div>
        <h1 className="display text-2xl font-semibold">Messages</h1>
        <p className="text-stone text-sm mt-1">Same message to the set with <span className="font-mono text-xs bg-surface border border-fog px-1 rounded">{"{{name}} {{discount}}"}</span>.</p>
      </div>
      <Card className="p-6 space-y-3">
        <h3 className="font-medium">New message</h3>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Name - e.g. Haven · VIP 20%" className="w-full h-9 rounded-full border border-fog bg-white px-4 text-sm" />
        <textarea value={body} onChange={e=>setBody(e.target.value)} rows={3} className="w-full rounded-xl border border-fog p-3 text-sm" />
        <input value={wpName} onChange={e=>setWpName(e.target.value)} placeholder="WhatsApp name" className="w-full h-9 rounded-full border border-fog bg-white px-4 text-sm" />
        {error && <div className="text-sm text-signal bg-red-50 border p-2 rounded-xl">{error}</div>}
        <Button onClick={handleCreate} disabled={saving} className="rounded-full">{saving?'Saving…':'Save message'}</Button>
      </Card>
      <div className="grid gap-3">
        {templates?.map((t:any)=>(
          <Card key={t.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="font-medium flex-1">{t.name}</div>
              <button
                onClick={async () => {
                  if (!confirm(`Delete "${t.name}"?`)) return;
                  await api.deleteTemplate(t.id);
                  refetch();
                }}
                className="w-7 h-7 rounded-full border border-fog grid place-items-center text-stone hover:bg-surface shrink-0"
                title="Delete template"
              >
                ×
              </button>
            </div>
            <div className="text-sm bg-surface border border-fog rounded-xl p-3 mt-2 whitespace-pre-wrap">{t.body}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function GoLiveWizard({ onClose }: { onClose: () => void }) {
  const { data: setup, refetch } = useQuery({ queryKey: ['setup'], queryFn: () => api.setupStatus() });
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetResult, setSheetResult] = useState<any>(null);
  const [waResult, setWaResult] = useState<any>(null);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [loadingWa, setLoadingWa] = useState(false);
  return (
    <div className="max-w-[640px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="display text-2xl font-semibold">Settings</h1>
        <Button variant="ghost" onClick={onClose} className="rounded-full">Close</Button>
      </div>
      <Card className="p-6">
        <h3 className="font-medium">Lend the ledger</h3>
        <p className="text-sm text-stone mt-1">Public sheets work instantly. Private needs a share with the Settings key.</p>
        {setup?.sheet?.serviceAccountEmail && <div className="mt-3 text-xs bg-surface border border-fog rounded-xl p-3">Settings key · <span className="font-mono">{setup.sheet.serviceAccountEmail}</span></div>}
        <div className="flex gap-2 mt-3">
          <input value={sheetUrl} onChange={e=>setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/.../edit" className="flex-1 h-9 rounded-full border border-fog bg-white px-4 text-sm" />
          <Button disabled={loadingSheet||!sheetUrl} onClick={async()=>{setLoadingSheet(true);try{const r=await api.testSheet(sheetUrl);setSheetResult(r);}catch(e:any){setSheetResult({ok:false,error:e.message});}setLoadingSheet(false);refetch();}} className="rounded-full">{loadingSheet?'Checking…':'Test'}</Button>
        </div>
        {sheetResult && <div className={`mt-3 text-sm rounded-xl p-3 border ${sheetResult.ok?'bg-emerald-50 border-emerald-200':'bg-red-50 border-red-200'}`}>{sheetResult.ok?`✓ ${sheetResult.title}`:`✗ ${sheetResult.error}`}</div>}
      </Card>
      <Card className="p-6">
        <h3 className="font-medium">Postmark WhatsApp</h3>
        <p className="text-sm text-stone mt-1">Marketing outside 24h needs approved message with <span className="font-mono text-xs">{"{{1}} {{2}}"}</span>.</p>
        {setup?.whatsapp?.phoneNumberId && <div className="mt-3 text-xs bg-surface border rounded-xl p-3">Phone ID · {setup.whatsapp.phoneNumberId}</div>}
        <Button disabled={loadingWa} onClick={async()=>{setLoadingWa(true);try{const r=await api.testWhatsapp();setWaResult(r);}catch(e:any){setWaResult({ok:false,error:e.message});}setLoadingWa(false);refetch();}} className="rounded-full mt-3">{loadingWa?'Checking…':'Test'}</Button>
        {waResult && <div className={`mt-3 text-sm rounded-xl p-3 border ${waResult.ok?'bg-emerald-50':'bg-red-50'}`}>{waResult.ok?`✓ ${waResult.mode}`:`✗ ${waResult.error}`}</div>}
      </Card>
      <Card className="bg-ink text-white p-4 flex items-center justify-between">
        <div><div className="text-xs opacity-60">Current press</div><div className="font-medium">{setup?.mode==='live'?'Live - posted':'Proof - not posted'}</div></div>
        <Badge className={setup?.mode==='live'?'bg-accent text-white border-accent':'bg-white/10 text-white border-white/20'}>{setup?.mode}</Badge>
      </Card>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <Shell />
    </QueryClientProvider>
  );
}
