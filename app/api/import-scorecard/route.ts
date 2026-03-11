import axios from "axios"
import * as cheerio from "cheerio"

export async function POST(req:Request){

const {url} = await req.json()

try{

const response = await axios.get(url)

const html = response.data

const $ = cheerio.load(html)

const stats:any = {}

$(".batting-table tbody tr").each((i,el)=>{

const name = $(el).find(".player-name").text().trim()

const runs = parseInt($(el).find(".runs").text()) || 0
const balls = parseInt($(el).find(".balls").text()) || 0

if(!stats[name]) stats[name] = {}

stats[name].runs = runs
stats[name].balls = balls

})

$(".bowling-table tbody tr").each((i,el)=>{

const name = $(el).find(".player-name").text().trim()

const wickets = parseInt($(el).find(".wickets").text()) || 0

if(!stats[name]) stats[name] = {}

stats[name].wickets = wickets

})

return Response.json({stats})

}

catch(e){

return Response.json({error:"Failed to import scorecard"})

}

}