// Explicit batch generation for existing published articles. Dry-run unless --apply.
// node scripts/blog-audio.mjs --env=.vercel/.env.production.local --apply
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
const envPath = process.argv.find(a => a.startsWith('--env='))?.slice(6);
if (!envPath) throw Error('Specify --env=path explicitly.');
const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
const apply = process.argv.includes('--apply');
const voice = 'knSie6HBvTFQgyX9Z7S5'; // Mini Carlos (verified in this account)
const model = 'eleven_multilingual_v2';
const output = '/tmp/carlos-blog-narrations';
fs.mkdirSync(output, { recursive: true });
function narration(post) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(post.markdown);
  function read(node) {
    if (['image', 'imageReference', 'html', 'definition', 'code', 'thematicBreak'].includes(node.type)) return '';
    if (node.type === 'link' && (node.title === 'audio' || /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/status\//.test(node.url))) return '';
    if (node.type === 'text' || node.type === 'inlineCode') return (node.value || '').replace(/::bot::/g, '');
    if (node.type === 'break') return '\n';
    const inline = ['paragraph', 'heading', 'strong', 'emphasis', 'link', 'delete', 'linkReference'].includes(node.type);
    return (node.children || []).map(read).join(inline ? '' : '\n\n');
  }
  return `${post.title}.\n\n${read(tree)}`.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
try {
  await mongoose.connect(env.MONGODB_URI);
  const posts = mongoose.connection.collection('blogposts');
  const media = mongoose.connection.collection('blogmedias');
  const items = await posts.find({ published: true }).sort({ publishedAt: 1 }).toArray();
  for (const post of items) {
    const text = narration(post);
    if (text.length > 10000) throw Error(`${post.slug}: exceeds model input limit; split narration first.`);
    const hash = createHash('sha256').update(JSON.stringify({ text, voice, model })).digest('hex');
    if (post.audioVersion?.hash === hash) { console.log(`Already current: ${post.slug}`); continue; }
    console.log(`${apply ? 'Generating' : 'Plan'}: ${post.slug} (${text.length} characters)`);
    if (!apply) continue;
    const file = path.join(output, `${post._id}-${hash}.mp3`);
    fs.writeFileSync(file.replace(/\.mp3$/, '.txt'), text);
    if (!fs.existsSync(file)) {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
        method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: model }), signal: AbortSignal.timeout(240000),
      });
      if (!response.ok) throw Error(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 600)}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length < 1000 || !response.headers.get('content-type')?.includes('audio')) throw Error('Invalid audio response.');
      fs.writeFileSync(file, data);
    }
    const data = fs.readFileSync(file);
    if (data.length > 4 * 1024 * 1024) throw Error('Audio exceeds media response size budget.');
    const existing = await media.findOne({ narrationHash: hash });
    const mediaId = existing?._id || new mongoose.Types.ObjectId();
    if (!existing) await media.insertOne({ _id: mediaId, data: new mongoose.mongo.Binary(data), mimeType: 'audio/mpeg', name: `${post.slug}-mini-carlos.mp3`, narrationHash: hash, createdAt: new Date(), updatedAt: new Date() });
    // Do not attach narration if the article changed during generation.
    const result = await posts.updateOne({ _id: post._id, published: true, markdown: post.markdown, title: post.title }, { $set: { audioVersion: { url: `/api/blog/media/${mediaId}`, voice: 'Mini Carlos', voiceId: voice, model, hash, generatedAt: new Date() } } });
    if (!result.matchedCount) throw Error(`${post.slug} changed during generation; audio retained for review.`);
    console.log(`Saved: ${post.slug} (${data.length} bytes)`);
  }
} finally { await mongoose.disconnect(); }
