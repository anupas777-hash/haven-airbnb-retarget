import * as React from 'react';

export function Button({ className='', variant='default', size='default', ...props}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default'|'outline'|'ghost'|'brass'|'ink', size?:'default'|'sm'|'lg'|'icon'}) {
  const base = 'inline-flex items-center justify-center rounded-full text-sm font-medium transition-colors focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none tracking-[-0.01em]';
  const variants: Record<string,string> = {
    default: 'bg-ink text-paper hover:bg-ink/90 shadow-sm',
    ink: 'bg-ink text-paper hover:bg-ink/90',
    brass: 'bg-brass text-ink hover:bg-brass/90 border border-brass',
    outline: 'border border-fog bg-white hover:bg-paper text-ink',
    ghost: 'hover:bg-fog/60 text-ink',
  };
  const sizes: Record<string,string> = {
    default: 'h-9 px-5 py-2',
    sm: 'h-7 px-3.5 text-xs',
    lg: 'h-10 px-7 text-[15px]',
    icon: 'h-9 w-9',
  };
  return <button className={`${base} ${variants[variant] || variants.default} ${sizes[size]} ${className}`} {...props} />;
}

export function Card({className='', ...props}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`paper rounded-2xl ${className}`} {...props} />;
}
export function CardHeader({className='', ...props}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`p-6 ${className}`} {...props} />;
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`flex h-9 w-full rounded-full border border-fog bg-white px-4 py-2 text-sm placeholder:text-stone/60 focus:outline-none focus:ring-2 focus:ring-brass/30 focus:border-brass ${props.className||''}`} {...props} />;
}
export function Label(props: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={`text-xs font-medium tracking-[0.08em] uppercase text-stone ${props.className||''}`} {...props} />;
}
export function Badge({className='', ...props}: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide ${className}`} {...props} />;
}
export function Chip({active, children, ...props}: {active?:boolean, children:React.ReactNode} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition tracking-wide ${active?'bg-ink text-paper border-ink':'bg-white border-fog hover:bg-paper text-stone'}`} {...props}>{children}</button>;
}
export function Stepper({steps, current}:{steps:string[], current:number}) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((s,i)=>{
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={s}>
            <div className={`flex items-center gap-2.5 py-1 px-2 rounded-full transition ${active ? 'bg-white border border-fog shadow-sm' : done ? 'opacity-70' : 'opacity-60'}`}>
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium mono border ${active ? 'bg-ink text-paper border-ink' : done ? 'bg-moss text-paper border-moss' : 'bg-white border-fog text-stone'}`}>{done ? '✓' : String(i+1).padStart(2,'0')}</span>
              <span className={`text-sm pr-1 ${active ? 'font-semibold text-ink display' : done ? 'text-moss' : 'text-stone'}`}>{s}</span>
            </div>
            {i < steps.length - 1 && <span className="w-6 h-px bg-fog mx-1 hidden sm:block" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}
export function StatusPill({status}:{status:string}) {
  const map:Record<string,string>={
    queued:'bg-paper text-stone border-fog',
    sent:'bg-[#E8ECE5] text-moss border-moss/20',
    delivered:'bg-moss text-paper border-moss',
    read:'bg-ink text-paper border-ink',
    failed:'bg-signal text-paper border-signal',
    draft:'bg-paper text-stone border-fog',
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium mono tracking-wide capitalize ${map[status]||'bg-paper'}`}>{status}</span>;
}
export function PreviewBubble({body, time}:{body:string, time?:string}) {
  return (
    <div className="bg-[#EDE7D8] p-5 rounded-2xl border border-fog">
      <div className="ticket-perf paper rounded-xl p-4 pt-6 shadow-ticket max-w-[92%] relative">
        <div className="ticket-staple" aria-hidden />
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap font-normal text-ink pr-6">{body}</p>
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-dashed border-fog">
          <span className="text-[11px] mono tracking-[0.08em] uppercase text-stone">{time || new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} · WhatsApp</span>
          <span className="text-moss text-xs tracking-wide">✓✓ delivered</span>
        </div>
        <div className="absolute -right-2 -bottom-2 stamp text-signal bg-paper/90 backdrop-blur px-2 py-1 text-[10px] rotate-[-6deg] border-signal hidden sm:inline-flex">Posted</div>
      </div>
      <p className="text-[11px] mono tracking-[0.06em] uppercase text-stone/70 mt-3 text-center">Ticket preview — variables rendered per guest</p>
    </div>
  );
}
