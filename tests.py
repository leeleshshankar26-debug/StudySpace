"""Run: python -m unittest -v. All writes use a disposable temporary directory."""
import io
import sqlite3
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from docx import Document
from pypdf import PdfWriter
from app import create_app, extract_concepts, build_mindmap, split_reading_sections

NOTES = '''Plant biology
Photosynthesis is the process by which plants convert sunlight into chemical energy.
Respiration is defined as the process by which cells release energy from food molecules.
Water movement
Osmosis refers to the movement of water across a selectively permeable membrane.
Diffusion is the movement of particles from higher to lower concentration.
Plant structure
The main function of Xylem is to transport water from roots to other plant parts.
Phloem consists of specialized cells that transport sugars throughout a plant.
'''


class StudySpaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.config = {'TESTING': True, 'SECRET_KEY': 'isolated-test-secret',
                       'DATABASE': str(Path(self.temp.name) / 'test.db'),
                       'UPLOAD_FOLDER': str(Path(self.temp.name) / 'uploads')}
        self.app = create_app(self.config)
        self.client = self.app.test_client()
        self.creds = dict(name='Student', email='student@example.com', password='password123')
        self.assertEqual(self.call('/register', self.creds).status_code, 200)
        self.assertEqual(self.call('/login', self.creds).status_code, 200)

    def tearDown(self):
        self.temp.cleanup()

    def token(self, client):
        return client.get('/api/session').json['csrf']

    def call(self, path, body=None, method='POST', client=None):
        client = client or self.client
        return client.open('/api' + path, method=method, json=body,
                           headers={'X-CSRF-Token': self.token(client)})

    def upload(self, content=NOTES.encode(), name='biology.txt'):
        response = self.client.post('/api/documents', data={'file': (io.BytesIO(content), name)},
                                    headers={'X-CSRF-Token': self.token(self.client)})
        response.request.environ['wsgi.input'].close()
        return response

    def state(self):
        return self.client.get('/api/data').json

    def sql(self, query, args=()):
        with closing(sqlite3.connect(self.config['DATABASE'])) as conn:
            with conn:
                return conn.execute(query, args).fetchall()

    def test_authentication_persistence_and_csrf(self):
        self.assertTrue(Path(self.config['UPLOAD_FOLDER']).is_dir())
        self.assertEqual(self.call('/register', self.creds).status_code, 400)
        self.assertEqual(self.call('/login', dict(email=self.creds['email'], password='wrong')).status_code, 400)
        self.assertEqual(self.client.post('/api/cards', json={}).status_code, 403)
        stored = self.sql('SELECT password FROM users')[0][0]
        self.assertNotEqual(stored, self.creds['password'])
        self.assertEqual(self.call('/logout', {}).status_code, 200)
        self.assertEqual(self.client.get('/api/data').status_code, 401)
        self.assertEqual(self.client.get('/').status_code, 302)
        for path in ('/login', '/register'):
            self.assertEqual(self.client.get(path).status_code, 200)
        restarted = create_app(self.config).test_client()
        self.assertEqual(self.call('/login', self.creds, client=restarted).status_code, 200)
        self.assertEqual(len(self.sql('SELECT * FROM users')), 1)

    def test_workspace_pages_palette_and_cache_versions(self):
        for route in ('/dashboard', '/materials', '/study', '/quizzes',
                      '/forgetless', '/revision', '/timer', '/settings'):
            response = self.client.get(route)
            self.assertEqual(response.status_code, 200, route)
            html = response.get_data(as_text=True)
            self.assertIn('/static/style.css?v=', html)
            self.assertIn('/static/script.js?v=', html)
            self.assertEqual(response.headers['X-StudySpace-Edition'], 'burgundy-workspace')
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
        css_response = self.client.get('/static/style.css')
        css = css_response.get_data(as_text=True)
        for colour in ('#800020', '#F3E6D5', '#FFF9F2', '#D45060'):
            self.assertIn(colour, css)
        for old_colour in ('#2e6b4f', '#1e4e39', '#e8f3ee', '#23634f'):
            self.assertNotIn(old_colour, css.lower())
        css_response.close()
        javascript_response = self.client.get('/static/script.js')
        javascript = javascript_response.get_data(as_text=True)
        for interaction in ('function study()', 'function quizzes()', 'function materials()',
                            "clicks('[data-reading-section]'", "if($('#upload-form'))", "if($('#quiz-form'))"):
            self.assertIn(interaction, javascript)
        for removed in ('Flashcards', 'flashcards', 'buildDeck', 'openDeck', 'bindDeckUpload',
                        'generateLearning', 'reader-flashcards', 'data-deck', 'data-card',
                        'Mind Map', 'Quick Review'):
            self.assertNotIn(removed, javascript)
        javascript_response.close()
        self.call('/logout', {})
        self.assertEqual(self.client.get('/flashcards').headers['Location'], '/dashboard')

    def test_removed_flashcards_urls_redirect_without_losing_saved_records(self):
        did = self.upload().json['id']
        self.call(f'/documents/{did}/flashcards', {'target': 5})
        self.call(f'/documents/{did}/mindmap', {})
        cid = self.state()['cards'][0]['id']
        self.call(f'/cards/{cid}', {'status':'revise'}, 'PUT')
        before = {table:self.sql(f'SELECT COUNT(*) FROM {table}')[0][0]
                  for table in ('users','documents','flashcards','card_reviews','mind_maps','sections')}
        for client in (self.client, self.app.test_client()):
            for url in ('/flashcards','/flashcards/','/flashcards/old-deck','/flashcards?document='+str(did)):
                response=client.get(url)
                self.assertEqual(response.status_code,302,url)
                self.assertEqual(response.headers['Location'],'/dashboard')
        after = {table:self.sql(f'SELECT COUNT(*) FROM {table}')[0][0] for table in before}
        self.assertEqual(before,after)
        self.assertTrue(self.state()['cards'])
        self.assertEqual(self.client.get(f'/api/documents/{did}/mindmap').status_code,200)

    def test_review_priority_inputs_persist_across_login(self):
        did = self.upload().json['id']
        self.call(f'/documents/{did}/flashcards', {'target': 5})
        cards = self.state()['cards']
        practice, known = cards[0], cards[1]
        self.call(f'/cards/{practice["id"]}', {'status': 'revise'}, 'PUT')
        self.call(f'/cards/{known["id"]}', {'status': 'known'}, 'PUT')
        self.call('/logout', {})
        self.call('/login', self.creds)
        persisted = {card['id']:card for card in self.state()['cards']}
        self.assertEqual(persisted[practice['id']]['status'], 'revise')
        self.assertEqual(persisted[known['id']]['status'], 'known')
        self.assertEqual(persisted[practice['id']]['reviews'], 1)
        self.assertEqual(persisted[known['id']]['reviews'], 1)

    def test_insufficient_source_keeps_uploaded_notes(self):
        did = self.upload(b'A short paragraph contains some useful notes but no complete definition patterns.', 'plain.txt').json['id']
        generated = self.call(f'/documents/{did}/flashcards', {'target': 10})
        self.assertEqual(generated.status_code, 400)
        self.assertIn('No reliable', generated.json['error'])
        self.assertEqual(self.client.get(f'/api/documents/{did}').status_code, 200)
        self.assertEqual(self.state()['cards'], [])

    def long_source(self):
        return '\n\n'.join('Chapter '+str(i+1)+'\n'+
                           ' '.join(f'This source sentence number {j} in chapter {i+1} explains a complete idea without changing the original wording.'
                                    for j in range(24)) for i in range(8))

    def test_reading_sections_preserve_source_structure(self):
        source = self.long_source()
        sections = split_reading_sections(source)
        self.assertGreaterEqual(len(sections), 6)
        self.assertLessEqual(len(sections), 8)
        self.assertEqual(' '.join(s['text'] for s in sections).split(), source.split())
        self.assertTrue(all(s['blocks'][0]['kind'] == 'heading' for s in sections))
        structured = 'Chapter 1\n\nPhotosynthesis is the process by which plants convert sunlight into chemical energy.\n\nBenefits\n\n- Preserves the first source bullet.\n- Preserves the second source bullet.\n\n3. The third original numbered item.\n4. The fourth original numbered item.'
        short = split_reading_sections(structured)
        self.assertEqual(len(short), 1)
        kinds = [b['kind'] for b in short[0]['blocks']]
        self.assertIn('heading', kinds)
        self.assertIn('paragraph', kinds)
        self.assertIn('bullet', kinds)
        self.assertIn('number', kinds)
        self.assertEqual([b['number'] for b in short[0]['blocks'] if b['kind']=='number'], [3,4])
        self.assertEqual(short[0]['text'].split(), structured.split())
        self.assertEqual(split_reading_sections(' \n\t'), [])
        # One long paragraph is divided only at complete sentences.
        prose = ' '.join(f'The source sentence {i} has enough clear words to test that its ending stays intact.' for i in range(150))
        split = split_reading_sections(prose)
        self.assertGreaterEqual(len(split), 6)
        self.assertEqual(' '.join(s['text'] for s in split).split(), prose.split())
        self.assertTrue(all(s['text'].endswith('.') for s in split))

    def test_reading_position_completion_and_ownership(self):
        did = self.upload(self.long_source().encode(), 'textbook.txt').json['id']
        detail = self.client.get(f'/api/documents/{did}').json
        sections = detail['sections']
        self.assertGreaterEqual(len(sections), 6)
        chosen = sections[3]
        self.assertEqual(self.call(f'/documents/{did}/position', {'section_id': chosen['id']}).status_code, 200)
        self.assertEqual(self.client.get(f'/api/documents/{did}').json['resume_position'], 3)
        self.assertEqual(self.state()['documents'][0]['reading_position'], 3)
        self.assertEqual(self.call('/sections/'+str(chosen['id']), {}).status_code, 200)
        self.assertEqual(self.state()['documents'][0]['completed'], 1)
        self.assertEqual(self.client.get(f'/api/documents/{did}').json['resume_position'], 3)
        other_doc = self.upload().json['id']
        other_section = self.client.get(f'/api/documents/{other_doc}').json['sections'][0]['id']
        self.assertEqual(self.call(f'/documents/{did}/position', {'section_id': other_section}).status_code, 400)
        other = self.app.test_client()
        creds = dict(name='Second', email='second@example.com', password='password123')
        self.call('/register', creds, client=other)
        self.call('/login', creds, client=other)
        self.assertEqual(self.call(f'/documents/{did}/position', {'section_id': chosen['id']}, client=other).status_code, 400)
        self.assertEqual(self.call('/sections/'+str(chosen['id']), {}, client=other).status_code, 400)
        restarted = create_app(self.config).test_client()
        self.call('/login', self.creds, client=restarted)
        self.assertEqual(restarted.get(f'/api/documents/{did}').json['resume_position'], 3)
        self.assertTrue(restarted.get(f'/api/documents/{did}').json['sections'][3]['completed'])
        anonymous = self.app.test_client()
        response = anonymous.get(f'/study?document={did}')
        self.assertEqual(response.status_code, 302)
        self.assertIn('next=/study%3Fdocument%3D', response.headers['Location'])

    def test_legacy_sections_are_retained_during_reader_upgrade(self):
        source = self.long_source()
        did = self.upload(source.encode(), 'legacy.txt').json['id']
        words = source.split()
        with closing(sqlite3.connect(self.config['DATABASE'])) as conn:
            with conn:
                conn.execute('DELETE FROM sections WHERE document_id=?', (did,))
                for pos, offset in enumerate(range(0, len(words), 160)):
                    conn.execute('INSERT INTO sections(document_id,position,text,completed,format_version) VALUES(?,?,?,?,0)',
                                 (did, pos, ' '.join(words[offset:offset+160]), 1))
        legacy_count = len(self.sql('SELECT id FROM sections WHERE document_id=? AND format_version=0', (did,)))
        upgraded = create_app(self.config).test_client()
        self.call('/login', self.creds, client=upgraded)
        current = upgraded.get(f'/api/documents/{did}').json['sections']
        self.assertGreaterEqual(len(current), 6)
        self.assertLessEqual(len(current), 8)
        self.assertTrue(all(s['completed'] for s in current))
        self.assertEqual(len(self.sql('SELECT id FROM sections WHERE document_id=? AND format_version=0', (did,))), legacy_count)
        create_app(self.config)
        self.assertEqual(len(self.sql('SELECT id FROM sections WHERE document_id=? AND format_version=1', (did,))), len(current))
        stats = upgraded.get('/api/data').json['documents'][0]
        self.assertEqual(stats['sections'], len(current))
        self.assertEqual(stats['completed'], len(current))

    def test_uploads_and_extraction(self):
        self.assertEqual(self.upload().status_code, 200)
        word = Document()
        word.add_paragraph(NOTES)
        buffer = io.BytesIO()
        word.save(buffer)
        self.assertEqual(self.upload(buffer.getvalue(), 'word.docx').status_code, 200)
        # A minimal text-bearing PDF; no extra test dependency is needed.
        objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
                   b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
                   b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
        content = b'BT /F1 10 Tf 10 700 Td (' + NOTES.replace('\n', ' ').encode() + b') Tj ET'
        objects.append(b'<< /Length ' + str(len(content)).encode() + b' >>\nstream\n' + content + b'\nendstream')
        raw, offsets = b'%PDF-1.4\n', []
        for i, obj in enumerate(objects, 1):
            offsets.append(len(raw))
            raw += f'{i} 0 obj\n'.encode() + obj + b'\nendobj\n'
        xref = len(raw)
        raw += b'xref\n0 6\n0000000000 65535 f \n' + b''.join(f'{o:010d} 00000 n \n'.encode() for o in offsets)
        raw += b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + str(xref).encode() + b'\n%%EOF'
        self.assertEqual(self.upload(raw, 'text.pdf').status_code, 200)
        blank = PdfWriter()
        blank.add_blank_page(width=200, height=200)
        buffer = io.BytesIO()
        blank.write(buffer)
        self.assertIn('extractable', self.upload(buffer.getvalue(), 'scan.pdf').json['error'])
        for raw, name in ((b'bad', 'bad.exe'), (b'bad', 'bad.pdf'), (b'\x00'*100, 'bad.txt')):
            self.assertEqual(self.upload(raw, name).status_code, 400)
        self.assertIn(self.upload(b'x'*(10*1024*1024+1), 'big.txt').status_code, (400, 413))
        self.assertEqual(len(self.state()['documents']), 3)

    def test_generation_reviews_maps_and_cascade(self):
        did = self.upload().json['id']
        self.assertEqual(len(extract_concepts(NOTES)), 6)
        self.assertEqual(len(extract_concepts(NOTES+NOTES)), 6)
        first = self.call(f'/documents/{did}/flashcards', {'target': 5})
        self.assertEqual(first.json['count'], 5)
        again = self.call(f'/documents/{did}/flashcards', {'target': 'all'})
        self.assertTrue(again.json['preserved'])
        cid = self.state()['cards'][0]['id']
        self.call(f'/cards/{cid}', {'status': 'revise'}, 'PUT')
        self.call(f'/cards/{cid}', {'status': 'known'}, 'PUT')
        self.assertEqual(self.sql('SELECT COUNT(*) FROM card_reviews')[0][0], 2)
        card = next(c for c in self.state()['cards'] if c['id'] == cid)
        self.assertEqual((card['reviews'], card['status']), (2, 'known'))
        self.assertTrue(card['source'])
        self.call('/cards', {'question': 'Manual?', 'answer': 'A manual card', 'document_id': did})
        self.assertEqual(self.call(f'/documents/{did}/flashcards', {'target': 'all', 'replace': True}).json['count'], 6)
        self.assertEqual(len(self.state()['cards']), 7)
        self.assertEqual(self.sql('SELECT COUNT(*) FROM card_reviews')[0][0], 0)
        generated = self.call(f'/documents/{did}/mindmap', {}).json
        self.assertEqual(len(generated['nodes']), 3)
        self.assertEqual(generated['nodes'][0]['children'][0]['label'], 'Photosynthesis')
        self.assertEqual(self.client.get(f'/api/documents/{did}/mindmap').json, generated)
        self.assertEqual(self.call(f'/documents/{did}/mindmap', {}).json, generated)
        self.assertEqual(self.call(f'/documents/{did}/mindmap', {'replace': True}).json, generated)
        self.assertTrue(build_mindmap('plain', 'Photosynthesis is a process that turns light into energy.')['nodes'])
        self.assertEqual(extract_concepts('Title\nThis is short.\nAn incomplete fragment'), [])
        section = self.client.get(f'/api/documents/{did}').json['sections'][0]
        self.assertEqual(self.call('/sections/'+str(section['id']), {}).status_code, 200)
        self.assertEqual(self.state()['documents'][0]['completed'], 1)
        self.call(f'/documents/{did}', method='DELETE')
        for table in ('flashcards', 'card_reviews', 'sections', 'mind_maps', 'questions'):
            self.assertEqual(self.sql(f'SELECT COUNT(*) FROM {table}')[0][0], 0)

    def submit(self, did, count, high=False):
        quiz = self.call('/quizzes', {'document_id': did, 'length': 5}).json
        self.assertEqual(len(quiz['questions']), 5)
        actual = dict(self.sql('SELECT a.id,q.answer FROM answers a JOIN questions q ON q.id=a.question_id WHERE a.attempt_id=?', (quiz['id'],)))
        answers = []
        for i, q in enumerate(quiz['questions']):
            correct = actual[q['id']]
            selected = correct if i<count else next(o for o in q['options'] if o!=correct)
            answers.append(dict(id=q['id'], selected=selected, confidence='High' if high else 'Medium'))
        self.assertEqual(self.call(f'/quizzes/{quiz["id"]}/submit', {'answers': []}).status_code, 400)
        response = self.call(f'/quizzes/{quiz["id"]}/submit', {'answers': answers})
        self.assertEqual(response.json['correct'], count)
        self.assertEqual(self.call(f'/quizzes/{quiz["id"]}/submit', {'answers': answers}).status_code, 400)

    def test_quiz_scoring_and_analytics_precedence(self):
        did = self.upload().json['id']
        self.assertEqual(self.state()['insights'][0]['status'], 'Not enough data yet')
        for score, status in ((2,'Needs Practice'), (3,'Developing'), (4,'Strong')):
            self.submit(did, score)
            self.assertEqual(self.state()['insights'][0]['status'], status)
        self.assertEqual(self.state()['insights'][0]['change'], 20)
        self.submit(did, 4, high=True)
        self.submit(did, 5)
        self.assertEqual(self.state()['insights'][0]['status'], 'Learning Gap')
        self.assertTrue(self.state()['gaps'])
        self.assertEqual(self.sql('SELECT COUNT(*) FROM answers WHERE confidence IS NOT NULL')[0][0], 25)

    def test_planner_settings_timer_and_activity(self):
        did = self.upload().json['id']
        self.assertEqual(self.call('/topics', dict(title='Revise', due='bad')).status_code, 400)
        self.call('/topics', dict(title='Revise', due='2026-10-30', document_id=did))
        tid = self.state()['topics'][0]['id']
        self.call(f'/topics/{tid}', dict(title='Edited', due='2026-11-01', document_id=did), 'PUT')
        self.call(f'/topics/{tid}', dict(completed=True), 'PUT')
        self.assertEqual(self.state()['topics'][0]['completed'], 1)
        self.call('/settings', {'name': 'New name'})
        self.assertEqual(self.client.get('/api/session').json['user']['name'], 'New name')
        for mode, duration in (('focus',1500), ('short',300), ('long',900)):
            started = time.time()
            with patch('app.now', return_value=started):
                timer = self.call('/timer/start', {'mode':mode,'document_id':did}).json
            self.assertEqual(timer['duration'], duration)
            self.assertEqual(self.call('/timer/finish', {'token':timer['token']}).status_code, 400)
            with patch('app.now', return_value=started+20):
                self.call('/timer/control', {'token':timer['token'],'action':'pause'})
            with patch('app.now', return_value=started+120):
                resumed = self.call('/timer/control', {'token':timer['token'],'action':'resume'}).json
            self.assertEqual(resumed['elapsed'], 20)
            with patch('app.now', return_value=started+120+duration-20):
                for _ in range(2):
                    self.assertEqual(self.call('/timer/finish', {'token':timer['token']}).status_code, 200)
        self.assertEqual(self.state()['study_seconds'], 1500)
        self.assertEqual(sum(d['seconds'] for d in self.state()['week']), 1500)
        self.assertEqual(len(self.state()['sessions']), 3)
        self.call(f'/topics/{tid}', method='DELETE')
        self.assertEqual(self.state()['topics'], [])

    def test_user_isolation(self):
        did = self.upload().json['id']
        self.call(f'/documents/{did}/flashcards', {'target':5})
        cid = self.state()['cards'][0]['id']
        self.call('/topics', dict(title='Private', due='2026-10-30'))
        tid = self.state()['topics'][0]['id']
        timer = self.call('/timer/start', {}).json['token']
        other = self.app.test_client()
        creds = dict(name='Other', email='other@example.com', password='password123')
        self.call('/register', creds, client=other)
        self.call('/login', creds, client=other)
        for path, method, body in [(f'/documents/{did}','GET',None), (f'/documents/{did}','DELETE',None),
                                   (f'/documents/{did}/flashcards','POST',{'target':5}), (f'/documents/{did}/mindmap','POST',{}),
                                   (f'/cards/{cid}','PUT',{'status':'known'}), (f'/topics/{tid}','DELETE',None),
                                   ('/quizzes','POST',{'document_id':did,'length':5}),
                                   ('/timer/finish','POST',{'token':timer}),
                                   ('/topics','POST',dict(title='Wrong',due='2026-10-30',document_id=did))]:
            self.assertEqual(self.call(path,body,method,other).status_code,400,path)
        self.assertEqual(other.get('/api/data').json['cards'], [])
        self.assertEqual(other.get('/api/data').json['documents'], [])


if __name__ == '__main__':
    unittest.main()
