const postgres = require('postgres');

const sql = postgres('postgresql://postgres:0YsIclS59LuX23Uz@db.ondgcelmtiymnlxxsgnp.supabase.co:5432/postgres');

async function run() {
  try {
    const email = 'obsideo.io@gmail.com';
    const users = await sql`SELECT id, email, storage_used_bytes FROM users WHERE email = ${email}`;
    if (!users.length) {
      console.log('--- USER NOT FOUND ---');
      return;
    }
    const user = users[0];
    console.log('--- USER INFO ---');
    console.log(JSON.stringify(user, null, 2));

    const files = await sql`
      SELECT id, file_size, created_at, deleted_at, jackal_fid, jackal_filename 
      FROM files 
      WHERE user_id = ${user.id} 
      ORDER BY created_at DESC
    `;
    console.log('\n--- ALL FILES ---');
    console.log(JSON.stringify(files, null, 2));

    const gv = await sql`
      SELECT id, original_file_id, filename, file_size, deletion_reason, deleted_at 
      FROM graveyard 
      WHERE user_id = ${user.id}
      ORDER BY deleted_at DESC
    `;
    console.log('\n--- GRAVEYARD ENTRIES ---');
    console.log(JSON.stringify(gv, null, 2));

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await sql.end();
  }
}

run();
