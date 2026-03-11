"use client";

import { useState } from "react";
import Link from "next/link";
import { players as initialPlayers } from "@/lib/players";

export default function AdminPage(){

const [players,setPlayers] = useState(initialPlayers);

function updateStat(id:number,field:string,value:any){

setPlayers(prev =>
prev.map(p =>
p.id === id ? {...p,[field]:value} : p
)
);

}

function resetStats(){

setPlayers(prev =>
prev.map(p => ({
...p,
runs:0,
balls:0,
wickets:0,
catches:0,
runouts:0,
wkCatches:0,
stumpings:0,
dismissed:false
}))
);

}

return(

<div className="bg-black text-white min-h-screen">

<div className="max-w-7xl mx-auto p-8">

<header className="flex justify-between items-center mb-10">

<h1 className="text-4xl font-bold text-red-500">
Admin Panel
</h1>

<nav className="flex gap-4 text-sm">

<Link href="/" className="bg-zinc-800 px-4 py-2 rounded">
Draft
</Link>

<Link href="/leaderboard" className="bg-zinc-800 px-4 py-2 rounded">
Leaderboard
</Link>

<Link href="/awards" className="bg-zinc-800 px-4 py-2 rounded">
Awards
</Link>

</nav>

</header>

<div className="flex justify-between items-center mb-6">

<p className="text-zinc-400">
Update player stats after each match
</p>

<button
onClick={resetStats}
className="bg-red-600 px-4 py-2 rounded"
>
Reset Weekly Stats
</button>

</div>

<div className="space-y-4">

{players.map(player => (

<div
key={player.id}
className="bg-zinc-900 border border-zinc-700 p-5 rounded-xl"
>

<div className="flex justify-between items-center mb-4">

<div>

<p className="font-semibold text-lg">
{player.name}
</p>

<p className="text-xs text-zinc-400">
£{player.price}
</p>

</div>

<label className="flex items-center gap-2 text-sm">

<input
type="checkbox"
checked={player.available}
onChange={(e)=>updateStat(player.id,"available",e.target.checked)}
/>

Playing This Week

</label>

</div>

<div className="grid grid-cols-2 md:grid-cols-4 gap-3">

<input
type="number"
value={player.runs}
placeholder="Runs"
onChange={(e)=>updateStat(player.id,"runs",Number(e.target.value))}
className="p-2 bg-zinc-800 rounded"
/>

<input
type="number"
value={player.balls}
placeholder="Balls"
onChange={(e)=>updateStat(player.id,"balls",Number(e.target.value))}
className="p-2 bg-zinc-800 rounded"
/>

<input
type="number"
value={player.wickets}
placeholder="Wickets"
onChange={(e)=>updateStat(player.id,"wickets",Number(e.target.value))}
className="p-2 bg-zinc-800 rounded"
/>

<input
type="number"
value={player.catches}
placeholder="Catches"
onChange={(e)=>updateStat(player.id,"catches",Number(e.target.value))}
className="p-2 bg-zinc-800 rounded"
/>

<input
type="number"
value={player.runouts}
placeholder="Runouts"
onChange={(e)=>updateStat(player.id,"runouts",Number(e.target.value))}
className="p-2 bg-zinc-800 rounded"
/>

<input
type="number"
value={player.wkCatches}
placeholder="WK Catches"
onChange={(e)=>updateStat(player.id,"wkCatches",Number(e.target.value))}
className="p-2 bg-zinc-800 rounded"
/>

<input
type="number"
value={player.stumpings}
placeholder="Stumpings"
onChange={(e)=>updateStat(player.id,"stumpings",Number(e.target.value))}
className="p-2 bg-zinc-800 rounded"
/>

<label className="flex items-center gap-2 text-sm">

<input
type="checkbox"
checked={player.dismissed}
onChange={(e)=>updateStat(player.id,"dismissed",e.target.checked)}
/>

Dismissed

</label>

</div>

</div>

))}

</div>

</div>

</div>

);

}