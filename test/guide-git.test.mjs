import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProjectFiles} from '../ui/project-files.js';
import {createProjectGit} from '../ui/project-git.js';
import {exportProject, importProject} from '../ui/project-cassette.js';
import {withGuide} from '../ui/guide.js';

test('Git tracks project README files while generated sys guides stay out of history and cassettes', async () => {
  const store = createProjectFiles({files: withGuide({'/index.js': 'log(1);\n', '/README.md': '# My music\n', '/lib/README.md': '# My helpers\n'})});
  const git = createProjectGit({getStore: () => store});
  await git.execute('init');
  assert.deepEqual((await git.execute('status')).files.map(file => file.path).sort(), ['README.md', 'index.js', 'lib/README.md']);
  await git.execute('stage', {paths: ['/']});
  await git.execute('commit', {name: 'Guide migration test', email: 'test@example.invalid', message: 'Track project documentation'});
  store.write('/README.md', '# Updated music\n');
  const diff = await git.execute('diff');
  assert.match(diff.text, /-# My music/);
  assert.match(diff.text, /\+# Updated music/);
  const loaded = importProject(exportProject({...store.snapshot(), runPath: '/index.js', selected: '/README.md', bpm: 120, clockMode: 'internal'}));
  assert.equal(loaded.files['/README.md'], '# Updated music\n');
  assert.equal(loaded.files['/lib/README.md'], '# My helpers\n');
  assert.equal(loaded.selected, '/README.md');
  assert.ok(Object.keys(loaded.files).every(path => !path.startsWith('/sys/')));
  const restored = createProjectFiles(loaded);
  assert.equal((await createProjectGit({getStore: () => restored}).execute('log'))[0].message.trim(), 'Track project documentation');
});
