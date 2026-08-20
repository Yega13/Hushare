import pg from 'pg'
import { connectionString } from './db-connection.mjs'
const c = new pg.Client({ connectionString: connectionString('bibwatch'), ssl: { rejectUnauthorized: false } })
await c.connect()
const q = `select count(*) filter (where bib_numbers is null) as unindexed,
                  count(*) filter (where bib_numbers is not null) as indexed,
                  count(*) filter (where bib_numbers is not null and array_length(bib_numbers,1) > 0) as with_bibs
           from photos where album_id=(select id from albums where slug='1daw2eeg') and media_type='image'`
for (let i = 0; i < 40; i++) {
  const { rows: [r] } = await c.query(q)
  if (Number(r.indexed) > 0) {
    console.log(`INDEXING WORKS — indexed=${r.indexed} unindexed=${r.unindexed} photos_with_race_numbers=${r.with_bibs}`)
    if (Number(r.unindexed) === 0) { console.log('COMPLETE — all photos indexed'); break }
  }
  await new Promise(s => setTimeout(s, 15000))
}
const { rows: [f] } = await c.query(q)
console.log(`final: indexed=${f.indexed} unindexed=${f.unindexed} with_race_numbers=${f.with_bibs}`)
await c.end()
