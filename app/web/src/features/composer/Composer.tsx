import { useState, useEffect, useMemo } from 'react';
import { api } from '@/lib/api';
import { Card, Button, Input, Label, PreviewBubble, Badge } from '@/components/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';

type ComposerProps = {
  campaignId: string;
  onNext: () => void;
  exampleGuest?: any; // from Audience selection
};

export function Composer({ campaignId, onNext, exampleGuest }: ComposerProps) {
  const [discount, setDiscount] = useState(10);
  const [templateId, setTemplateId] = useState<string>('');
  const [body, setBody] = useState('');
  const [variables, setVariables] = useState<Array<{ key: string; mappedTo: string }>>([
    { key: '1', mappedTo: 'name' },
    { key: '2', mappedTo: 'discount' },
    { key: '3', mappedTo: 'brand' },
  ]);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customBody, setCustomBody] = useState('Hi {{name}} - we miss you at {{brand}}! Here’s {{discount}} off your next visit.');
  const [filter, setFilter] = useState('');

  const qc = useQueryClient();
  const { data: campaign } = useQuery({ queryKey: ['campaign', campaignId], queryFn: () => api.getCampaign(campaignId), enabled: !!campaignId });
  const { data: templates } = useQuery({ queryKey: ['templates'], queryFn: () => api.templates() });
  // Fallback guest if no exampleGuest from selection
  const { data: customers } = useQuery({ queryKey: ['customers-preview', campaignId], queryFn: () => api.customers({ page: 1, pageSize: 20, from: '1970-01-01', to: '2100-01-01' }), enabled: !!campaignId });

  const example = useMemo(() => {
    if (exampleGuest) return exampleGuest;
    if (customers?.items?.[0]) return customers.items[0];
    return null;
  }, [exampleGuest, customers]);

  const exampleName = example?.name?.split(' ')[0] || example?.name || 'there';

  function localRender(b: string, customer: any, disc: number): string {
    if (!customer) return b;
    const name = customer.name?.split(' ')[0] || customer.name || '';
    return b
      .replace(/\{\{name\}\}/g, name)
      .replace(/\{\{discount\}\}/g, `${disc}%`)
      .replace(/\{\{brand\}\}/g, 'Haven')
      .replace(/\{\{1\}\}/g, name)
      .replace(/\{\{2\}\}/g, `${disc}%`)
      .replace(/\{\{3\}\}/g, 'Haven');
  }

  // sync from campaign
  useEffect(() => {
    if (campaign) {
      setDiscount(campaign.discountPercent || 10);
      if (campaign.templateId) setTemplateId(campaign.templateId);
      const t = templates?.find((x: any) => x.id === campaign.templateId);
      if (t) setBody(t.body);
      else if (templates?.[0] && !body) setBody(templates[0].body);
    }
  }, [campaign, templates]);

  useEffect(() => {
    if (templates && !templateId && templates.length) {
      setTemplateId(templates[0].id);
      setBody(templates[0].body);
    }
  }, [templates]);

  useEffect(() => {
    const t = templates?.find((x: any) => x.id === templateId);
    if (t) {
      setBody(t.body);
      setVariables(t.variables || [{ key: '1', mappedTo: 'name' }, { key: '2', mappedTo: 'discount' }, { key: '3', mappedTo: 'brand' }]);
    }
  }, [templateId]);

  const filteredTemplates = (templates || []).filter((t: any) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return t.name.toLowerCase().includes(f) || t.body.toLowerCase().includes(f);
  });

  async function handleSaveAndNext() {
    if (!body.includes('{{name}}') && !body.includes('{{1}}') && !body.includes('{{discount}}') && !body.includes('{{2}}') && !body.includes('{{brand}}')) {
      setValidation('Include at least one variable like {{name}} or {{discount}}.');
      return;
    }
    setValidation(null);
    setSaving(true);
    try {
      let tid = templateId;
      const selected = templates?.find((t: any) => t.id === templateId);
      if (selected && selected.body !== body) {
        const created = await api.createTemplate({
          name: `Custom - ${new Date().toISOString().slice(0, 10)} ${Math.random().toString(36).slice(2, 4).toUpperCase()}`,
          body,
          variables,
          whatsappTemplateName: selected.whatsappTemplateName,
          locale: selected.locale,
        });
        tid = created.id;
        qc.invalidateQueries({ queryKey: ['templates'] });
      }
      await api.patchCampaign(campaignId, { discountPercent: discount, templateId: tid });
      onNext();
    } catch (e: any) {
      setValidation(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateCustom() {
    setValidation(null);
    if (!customName || !customBody) {
      setValidation('Name and body required');
      return;
    }
    try {
      const created = await api.createTemplate({ name: customName, body: customBody, whatsappTemplateName: `custom_${Date.now()}`, locale: 'en_US', variables });
      qc.invalidateQueries({ queryKey: ['templates'] });
      setTemplateId(created.id);
      setBody(created.body);
      setShowCustom(false);
      setCustomName('');
    } catch (e: any) {
      setValidation(e.message);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Left: templates + edit */}
      <div className="lg:col-span-3 space-y-4">
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="display font-[600] text-ink">Choose a message</h3>
            <Badge className="bg-ink text-paper border-ink mono text-[11px]">{templates?.length || 0} messages</Badge>
          </div>
          <p className="mono text-[11px] leading-4 text-stone">
            Pick one guest as example - <span className="text-ink font-medium">{example ? `${example.name} · ${example.phoneE164 ? `••••${example.phoneE164.slice(-4)}` : example.phoneRaw}` : 'no guest yet'}</span> - every message below shows how it will read for them. Same message goes to your whole set, per-guest stamp.
          </p>

          <div className="flex gap-2">
            <Input placeholder="Filter messages (VIP, Festive…)" value={filter} onChange={(e) => setFilter(e.target.value)} className="flex-1" />
            <Button variant={showCustom ? 'default' : 'outline'} size="sm" onClick={() => setShowCustom((v) => !v)} className="rounded-full">
              {showCustom ? 'Close' : '+ New'}
            </Button>
          </div>

          {showCustom && (
            <Card className="p-4 bg-paper border-dashed space-y-3">
              <h4 className="display font-[600] text-sm">New message</h4>
              <Input placeholder="Name - e.g. Haven · VIP 20%" value={customName} onChange={(e) => setCustomName(e.target.value)} />
              <textarea value={customBody} onChange={(e) => setCustomBody(e.target.value)} rows={3} className="w-full rounded-xl border border-fog p-3 text-sm" placeholder="Hi {{name}} - … {{discount}} … {{brand}}" />
              <p className="mono text-[11px] text-stone">Use {'{{name}}'} {'{{discount}}'} {'{{brand}}'} → {'{{1}}'} {'{{2}}'} {'{{3}}'}</p>
              <Button size="sm" onClick={handleCreateCustom} className="rounded-full">
                Save & select
              </Button>
            </Card>
          )}

          <div className="grid gap-3 max-h-[520px] overflow-auto pr-1">
            {filteredTemplates.map((t: any) => {
              const isActive = templateId === t.id;
              const rendered = example ? localRender(t.body, example, discount) : t.body;
              return (
                <div
                  key={t.id}
                  onClick={() => setTemplateId(t.id)}
                  className={`text-left rounded-2xl border p-3 transition cursor-pointer ${isActive ? 'border-ink bg-ink text-paper shadow' : 'border-fog bg-white hover:bg-paper'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className={`display font-[600] text-sm leading-tight flex-1 ${isActive ? 'text-paper' : 'text-ink'}`}>{t.name}</div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isActive && <span className="mono text-[10px] bg-brass text-ink px-2 py-0.5 rounded-full">selected</span>}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm(`Delete "${t.name}"?`)) return;
                          await api.deleteTemplate(t.id);
                          qc.invalidateQueries({ queryKey: ['templates'] });
                          if (templateId === t.id) setTemplateId('');
                        }}
                        className={`w-7 h-7 rounded-full grid place-items-center border text-xs ${isActive ? 'border-white/20 text-white hover:bg-white/10' : 'border-fog text-stone hover:bg-surface'}`}
                        title="Delete"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className={`mt-1 mono text-[11px] whitespace-pre-wrap ${isActive ? 'text-paper/70' : 'text-stone'}`}>{t.body.slice(0, 88)}{t.body.length > 88 ? '…' : ''}</div>
                  {/* per-template preview for example guest */}
                  <div className={`mt-3 rounded-xl p-3 border ${isActive ? 'bg-paper text-ink border-paper' : 'bg-paper border-fog'}`}>
                    <div className="mono text-[10px] tracking-[0.08em] uppercase text-stone">Preview as {exampleName} · {discount}%</div>
                    <div className="text-sm leading-5 mt-1 whitespace-pre-wrap">{rendered}</div>
                  </div>
                </div>
              );
            })}
            {!filteredTemplates.length && <div className="mono text-sm text-stone text-center py-6">No messages match “{filter}”</div>}
          </div>

          <div className="space-y-2 pt-2 border-t border-fog">
            <Label>Or edit selected message</Label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="w-full rounded-xl border border-fog p-3 text-sm" placeholder="Hi {{name}} - we miss you! Here's {{discount}} off…" />
            <p className="mono text-[11px] text-stone">Edit creates a new message on save.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Discount % for this send</Label>
              <Input type="number" min={1} max={90} value={discount} onChange={(e) => setDiscount(parseInt(e.target.value) || 10)} />
            </div>
            <div className="space-y-1">
              <Label>Example guest</Label>
              <div className="h-9 rounded-full border border-fog bg-paper px-3 text-sm flex items-center mono text-xs">
                {example ? `${example.name} · ${example.phoneE164 ? `••••${example.phoneE164.slice(-4)}` : ''}` : 'No guest in set - using first ledger entry'}
              </div>
            </div>
          </div>

          {validation && <div className="text-sm text-signal bg-signal/10 border border-signal/20 rounded-xl p-2.5">{validation}</div>}
          <Button onClick={handleSaveAndNext} disabled={saving} className="w-full rounded-full">
            {saving ? 'Saving…' : 'Save message → Review'}
          </Button>
        </Card>
      </div>

      <div className="lg:col-span-2 space-y-4">
        <Card className="p-5">
          <h3 className="display font-[600] mb-3">Live message - {exampleName}</h3>
          <PreviewBubble body={example ? localRender(body, example, discount) : 'Pick a guest in Define to preview…'} />
          <div className="mt-4 mono text-[11px] leading-4 text-stone space-y-1">
            <div>Same message posts to your whole set ({example ? 'e.g. ' + example.name : '-'}), each stamped with their own name/discount.</div>
            <div>Discount <span className="bg-paper border border-fog px-1 rounded mono text-xs">{discount}%</span> is a variable, not hard-coded.</div>
          </div>
        </Card>
        <Card className="p-4 bg-brass/10 border-brass/20">
          <p className="mono text-xs text-ink">
            <strong>Meta rule:</strong> Outside 24h you must post an approved message. Free text only in-session.
          </p>
        </Card>
      </div>
    </div>
  );
}
