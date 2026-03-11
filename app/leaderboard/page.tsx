"use client";

import { useEffect, useState } from "react";

export default function Leaderboard(){

const [teams,setTeams]=useState<any[]>([]);

useEffect(()=>{

const saved=localStorage.getItem("nondies-fantasy-v6");

if(saved){

const parsed=JSON.parse(saved);
setTeams(parsed.teams||[]);

}

},[]);

return(

<div className="p-10 bg-black text-white min-h-screen">

<h1 className="text-3xl mb-6">Leaderboard</h1>

{teams.map((team,i)=>(

<div key={team.id} className="bg-zinc-900 p-4 mb-3 rounded">

<p>#{i+1} {team.name}</p>

</div>

))}

</div>

);

}