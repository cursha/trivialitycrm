"use client";

import { useState } from "react";
import Image from "next/image";
import { BarChart3, Bot, Building2, CalendarClock, ChevronDown, CirclePlus, FileSpreadsheet, Filter, LayoutDashboard, Menu, Search, Settings, Target, Users, X } from "lucide-react";
import { leads, navItems } from "@/lib/demo-data";

const icons = [LayoutDashboard, Bot, Search, Building2, Target, CalendarClock, Users, FileSpreadsheet, Settings];

function Pill({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "green" | "amber" | "red" }) {
  const colors = { blue: "bg-blue-50 text-blue-700", green: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", red: "bg-red-50 text-red-700" };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${colors[tone]}`}>{children}</span>;
}

export default function Home() {
  const [active, setActive] = useState("Dashboard");
  const [mobile, setMobile] = useState(false);
  const [query, setQuery] = useState("");

  return <main className="min-h-screen bg-[#f5f7fb] text-slate-900">
    <aside className={`fixed inset-y-0 left-0 z-30 w-64 border-r border-slate-200 bg-[#10233f] text-white transition-transform lg:translate-x-0 ${mobile ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-24 items-center justify-between border-b border-white/10 px-5">
        <div className="flex items-center gap-3"><Image src="/triviality-mayhem-logo.png" alt="Triviality Mayhem" width={142} height={80} className="h-[72px] w-auto object-contain" priority/><span className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-black tracking-[.18em] text-blue-200">CRM</span></div>
        <button className="lg:hidden" onClick={() => setMobile(false)}><X size={20}/></button>
      </div>
      <nav className="space-y-1 p-3">{navItems.map((item, i) => { const Icon = icons[i]; return <button key={item} onClick={() => {setActive(item);setMobile(false)}} className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium ${active === item ? "bg-blue-500 text-white shadow-lg shadow-blue-950/20" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}><Icon size={18}/>{item}</button>})}</nav>
    </aside>

    <section className="lg:pl-64">
      <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur lg:px-8">
        <div className="flex items-center gap-3"><button className="rounded-lg border p-2 lg:hidden" onClick={() => setMobile(true)}><Menu size={20}/></button><div><h1 className="text-xl font-bold">{active}</h1><p className="hidden text-sm text-slate-500 sm:block">North American trivia sales intelligence</p></div></div>
        <div className="flex items-center gap-3"><button className="hidden rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold sm:block">Help</button><div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 font-bold text-white">CS</div></div>
      </header>

      <div className="p-5 lg:p-8">
        {active === "Dashboard" ? <Dashboard setActive={setActive}/> : active === "AI Lead Search" ? <LeadSearch query={query} setQuery={setQuery}/> : <ModulePage name={active}/>} 
      </div>
    </section>
  </main>;
}

function Dashboard({ setActive }: { setActive: (v:string)=>void }) {
  const stats = [{label:"Active leads",value:"247",detail:"+18 this month"},{label:"Follow-ups due",value:"12",detail:"4 overdue"},{label:"Demos scheduled",value:"8",detail:"Next 14 days"},{label:"Won this month",value:"6",detail:"$4,800 projected"}];
  return <div className="mx-auto max-w-7xl space-y-7">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h2 className="text-3xl font-black tracking-tight">Good afternoon, Curt</h2><p className="mt-1 text-slate-500">Here is what needs your attention today.</p></div><button onClick={()=>setActive("AI Lead Search")} className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-bold text-white shadow-lg shadow-blue-200"><CirclePlus size={19}/>Find new leads</button></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{stats.map((s,i)=><div key={s.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">{s.label}</p><div className="mt-2 flex items-end justify-between"><strong className="text-3xl">{s.value}</strong><BarChart3 className={i===1?"text-red-400":"text-blue-400"}/></div><p className={`mt-2 text-xs font-semibold ${i===1?"text-red-600":"text-emerald-600"}`}>{s.detail}</p></div>)}</div>
    <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b p-5"><div><h3 className="font-bold">Priority leads</h3><p className="text-sm text-slate-500">Highest-scoring active opportunities</p></div><button onClick={()=>setActive("CRM Leads")} className="text-sm font-bold text-blue-600">View all</button></div><LeadTable/></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-bold">Pipeline</h3><p className="text-sm text-slate-500">247 active locations</p><div className="mt-6 space-y-4">{[["New",82,33],["Material Sent",64,26],["Demo Given",43,17],["Trial",31,13],["Booked",27,11]].map(([name,count,pct])=><div key={name as string}><div className="mb-1.5 flex justify-between text-sm"><span className="font-medium">{name}</span><b>{count}</b></div><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-blue-500" style={{width:`${pct}%`}}/></div></div>)}</div></div>
    </div>
  </div>
}

function LeadTable(){ return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Company","Score","Stage","Follow-up"].map(h=><th key={h} className="px-5 py-3">{h}</th>)}</tr></thead><tbody>{leads.map(l=><tr key={l.name} className="border-t border-slate-100 hover:bg-blue-50/40"><td className="px-5 py-4"><div className="font-bold">{l.name}</div><div className="text-xs text-slate-500">{l.city}, {l.region} · {l.type}</div></td><td className="px-5"><span className="font-black text-emerald-600">{l.score}</span></td><td className="px-5"><Pill>{l.stage}</Pill></td><td className="px-5"><span className={l.followUp==="Overdue"?"font-bold text-red-600":""}>{l.followUp}</span></td></tr>)}</tbody></table></div> }

function LeadSearch({query,setQuery}:{query:string;setQuery:(v:string)=>void}) { return <div className="mx-auto max-w-5xl space-y-6"><div><h2 className="text-3xl font-black">Find the right locations</h2><p className="mt-1 text-slate-500">Describe what you want. AI will research, verify and rank the matches.</p></div><div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><label className="text-sm font-bold">What kind of prospects do you want?</label><textarea value={query} onChange={e=>setQuery(e.target.value)} placeholder="Show me entertainment-ready pubs in Colorado that offer events but not trivia..." className="mt-2 min-h-32 w-full resize-none rounded-xl border border-slate-300 p-4 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"/><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{["Country","State / Province","Cities (optional)","Lead type"].map((x,i)=><button key={x} className="flex items-center justify-between rounded-lg border bg-white px-3 py-3 text-left text-sm"><span className={i<2?"font-semibold":"text-slate-500"}>{i===0?"Canada":i===1?"Ontario":x}</span><ChevronDown size={15}/></button>)}</div><div className="mt-5 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><label className="text-sm font-semibold">Minimum score</label><input type="range" min="0" max="100" defaultValue="80" className="accent-blue-600"/><Pill tone="green">80+</Pill></div><button className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-7 py-3 font-bold text-white"><Search size={18}/>Research leads</button></div></div><div className="grid gap-4 md:grid-cols-3">{["Events without trivia","Confirmed current trivia","Competitor locations"].map((x,i)=><button key={x} onClick={()=>setQuery(i===0?"Find locations offering recurring events but no current trivia":i===1?"Find locations with verified current recurring trivia":"Show me bars that use a selected competitor")} className="rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-blue-400 hover:shadow-md"><div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Filter size={18}/></div><b>{x}</b><p className="mt-1 text-sm text-slate-500">Use a proven qualification template.</p></button>)}</div></div> }

function ModulePage({name}:{name:string}) { const copy:Record<string,string>={"Saved Searches":"Continue prior research without repeating reviewed companies.","CRM Leads":"Search, filter and manage every qualified company.","Pipeline":"Move opportunities through your editable sales process.","Follow-Ups":"See due, upcoming, completed and overdue sales tasks.","Competitors":"Track competitor records and their automatically counted locations.","Import & Mapping":"Map any CSV or Excel layout into one clean CRM database.","Settings":"Manage users, permissions, lead types, stages and rejection reasons."}; return <div className="mx-auto max-w-7xl"><div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"><div className="flex items-start justify-between gap-4"><div><h2 className="text-3xl font-black">{name}</h2><p className="mt-2 text-slate-500">{copy[name]}</p></div><button className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white">Add new</button></div><div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center"><Building2 className="mx-auto text-blue-500" size={36}/><h3 className="mt-3 font-bold">Module foundation ready</h3><p className="mx-auto mt-1 max-w-md text-sm text-slate-500">The data model and responsive workspace are prepared for live database connection during installation.</p></div></div></div> }
