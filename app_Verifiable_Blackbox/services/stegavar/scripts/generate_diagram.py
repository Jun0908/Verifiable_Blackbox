"""Create a self-contained, scalable diagram with actual sample thumbnails."""
import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / 'apps/web/public/stegavar'
OUTPUT = ROOT / 'illustrations'
OUTPUT.mkdir(parents=True, exist_ok=True)


def embedded(path):
    return 'data:image/png;base64,' + base64.b64encode((ROOT / path).read_bytes()).decode('ascii')


stego = embedded('rover-moving/surf/stego/0014.png')
recovered = embedded('rover-moving/surf/recovered/0014.png')
svg = '''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1280" height="640" viewBox="0 0 1280 640">
<title>見た目はバカンス、中身はお仕事。ロボットの作業映像を隠して検証する仕組み</title>
<desc>緑の範囲はRoverの録画、埋込み、復元、動きの計測。作業映像を実写カバーへLF-VSNで埋め込み、保存したStegoから復元したフレームの差分を計測する。運搬完了の自動判定は今後の拡張。</desc>
<defs>
 <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M1 1l5 3-5 3" fill="none" stroke="#79916b" stroke-width="1.6"/></marker>
 <clipPath id="stego"><rect x="550" y="230" width="176" height="99" rx="7"/></clipPath>
 <clipPath id="secret"><rect x="798" y="230" width="176" height="99" rx="7"/></clipPath>
 <g id="arm" stroke="#294439" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M0 65h43l-5-11H6z" fill="#b2cfaf"/><path d="M22 51l-8-32 37-21 26 21" fill="none" stroke="#a6c3ac" stroke-width="12"/><path d="M22 51l-8-32 37-21 26 21" fill="none" stroke-width="3"/><circle cx="14" cy="19" r="7" fill="#e5edc9"/><circle cx="51" cy="-2" r="7" fill="#e5edc9"/><path d="M71 15l12 6-3 12m-10-6 9 7" fill="none"/></g>
 <g id="rover" stroke="#294439" stroke-width="3" stroke-linejoin="round">
  <rect x="2" y="31" width="86" height="29" rx="7" fill="#b2cfaf"/><circle cx="18" cy="62" r="10" fill="#294439"/><circle cx="71" cy="62" r="10" fill="#294439"/>
  <circle cx="18" cy="62" r="4" fill="#e5edc9"/><circle cx="71" cy="62" r="4" fill="#e5edc9"/><rect x="9" y="9" width="25" height="24" rx="5" fill="#efac83"/>
  <rect x="15" y="14" width="13" height="9" rx="2" fill="#294439"/><rect x="40" y="1" width="39" height="31" rx="3" fill="#edbe94"/><path d="M59 2v28" stroke="#cb9c75"/>
 </g>
 <g id="robot" stroke="#294439" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
  <path d="M23 52v-9m31 9V39"/><rect x="6" y="50" width="64" height="48" rx="14" fill="#dceabc"/><path d="M36 49V37"/><circle cx="36" cy="33" r="4" fill="#efac83"/>
  <rect x="12" y="63" width="23" height="15" rx="5" fill="#294439"/><rect x="43" y="63" width="21" height="15" rx="5" fill="#294439"/><path d="M35 68h9m-19 18q11 8 23-1" fill="none"/>
  <path d="M22 98v22m30-22v22M11 118h17m15 0h17"/><path d="M7 83l-17-12m79 12 15-9"/>
 </g>
</defs>
<style>text{font-family:'Segoe UI','Yu Gothic UI',Meiryo,sans-serif;fill:#294439}.eyebrow{font-size:11px;letter-spacing:1.5px;fill:#8d9c7e}.title{font-size:21px;font-weight:600}.body{font-size:13px;fill:#7b8d6e}.small{font-size:11px;fill:#8b9c7b}.label{font-size:12px;font-weight:600}.muted{fill:#a1aa95}</style>
<rect width="1280" height="640" fill="#fffefa"/>
<text x="35" y="39" class="eyebrow">FROM A CAMERA TO PROOF OF WORK</text>
<text x="1245" y="39" text-anchor="end" class="small">ロボットの仕事を、映像から確かめるプロジェクト</text>
<!-- Scope ribbon -->
<rect x="28" y="72" width="977" height="444" rx="18" fill="#eef4e2" stroke="#bacb9a" stroke-width="1.5"/>
<rect x="290" y="58" width="158" height="29" rx="14" fill="#294439"/><text x="369" y="77" text-anchor="middle" font-size="11" fill="#e0f294" style="fill:#e0f294">このデモのしくみ</text>
<text x="984" y="104" text-anchor="end" class="small">録画 → 埋込み → 復元 → 動きを計測</text>
<!-- Rover recording -->
<rect x="28" y="156" width="212" height="288" rx="12" fill="#fffefa" stroke="#d2ddc2"/>
<text x="48" y="184" class="eyebrow">01 / RECORD</text><text x="48" y="216" class="title">仕事ぶりを撮る</text>
<g transform="translate(57 261)"><use href="#rover"/></g>
<g transform="translate(174 250)" stroke="#849275" fill="none" stroke-width="2"><rect x="-7" y="-17" width="29" height="21" rx="4"/><circle cx="8" cy="-6" r="6"/><path d="M7 6v17m-9 10 9-10 10 10M-12 0l-24 18"/></g>
<text x="48" y="364" class="body">動くRover / 静止するRover</text><text x="48" y="390" class="small">実機の録画2本を使用</text>
<rect x="48" y="410" width="74" height="21" rx="10" fill="#ecefe5"/><text x="85" y="425" text-anchor="middle" class="small">RECORDED</text>
<path d="M243 301h33" stroke="#a7b49a" stroke-width="2" stroke-dasharray="4 4" marker-end="url(#arrow)"/>
<!-- Encoder -->
<rect x="285" y="156" width="210" height="288" rx="12" fill="#fffefa" stroke="#d2ddc2"/>
<text x="304" y="184" class="eyebrow">02 / HIDE</text><text x="304" y="216" class="title">動画に動画を隠す</text>
<rect x="307" y="245" width="65" height="44" rx="5" fill="#cae5e8" stroke="#91b4ad"/><path d="M310 273q15-20 30-2t30-2" fill="none" stroke="#62a5ab" stroke-width="4"/><circle cx="358" cy="255" r="5" fill="#f0cf7e"/>
<text x="382" y="274" font-size="22" fill="#839871">+</text>
<g transform="translate(414 246) scale(.55)"><use href="#rover"/></g>
<path d="M343 298v17h48v11m57-28v17h-57" fill="none" stroke="#b2c39c" stroke-width="2"/>
<rect x="333" y="328" width="116" height="34" rx="7" fill="#dcebbb"/><text x="391" y="350" text-anchor="middle" font-size="13" font-weight="600">LF-VSN</text>
<text x="304" y="390" class="body">カバー ＋ 秘密の作業映像</text><text x="304" y="415" class="small">StegaVARの埋め込み処理</text>
<path d="M498 301h30" stroke="#7f9a66" stroke-width="2" marker-end="url(#arrow)"/>
<!-- Stego -->
<rect x="533" y="156" width="210" height="288" rx="12" fill="#fffefa" stroke="#d2ddc2"/>
<text x="550" y="184" class="eyebrow">03 / STEGO</text><text x="550" y="216" class="title">見た目はバカンス</text>
<image href="STEGOPNG" x="550" y="230" width="176" height="99" clip-path="url(#stego)"/>
<rect x="566" y="314" width="145" height="28" rx="14" fill="#294439"/><text x="638" y="332" text-anchor="middle" font-size="10" style="fill:#e5f39f">中のロボットは勤務中。</text>
<text x="550" y="372" class="body">画素の小さな変化に埋め込む</text><text x="550" y="394" class="small">保存したStego動画だけを</text><text x="550" y="412" class="small">復元処理へ渡す</text>
<path d="M746 301h30" stroke="#7f9a66" stroke-width="2" marker-end="url(#arrow)"/>
<!-- Recover -->
<rect x="781" y="156" width="210" height="288" rx="12" fill="#fffefa" stroke="#d2ddc2"/>
<text x="798" y="184" class="eyebrow">04 / REVEAL + MEASURE</text><text x="798" y="216" class="title">中身の動作を読む</text>
<image href="SECRETPNG" x="798" y="230" width="176" height="99" clip-path="url(#secret)"/>
<text x="798" y="357" class="body">LF-VSNでロボット映像を復元</text><text x="798" y="381" class="body">復元フレームの差分を計測</text>
<rect x="799" y="397" width="173" height="28" rx="6" fill="#edf1e5"/><text x="885" y="415" text-anchor="middle" class="small">動作あり / ほぼ静止 / 判定保留</text>
<path d="M994 301h30" stroke="#a7b49a" stroke-width="2" stroke-dasharray="4 4" marker-end="url(#arrow)"/>
<!-- Future verifier -->
<rect x="1029" y="156" width="223" height="288" rx="12" fill="#fafaf6" stroke="#cdd4c3" stroke-dasharray="6 5"/>
<text x="1048" y="184" class="eyebrow">05 / VERIFY</text><text x="1048" y="216" class="title">仕事、終わった？</text>
<rect x="1082" y="239" width="110" height="91" rx="10" fill="#f1f3eb" stroke="#b7c4a7" stroke-width="2"/><rect x="1110" y="230" width="54" height="16" rx="5" fill="#d6dec9"/>
<path d="m1098 260 4 4 8-9m-12 25 4 4 8-9" fill="none" stroke="#99ad7f" stroke-width="3"/><path d="M1123 260h47m-47 20h47" stroke="#c1ceb2" stroke-width="3"/>
<circle cx="1104" cy="302" r="5" fill="none" stroke="#c4cdbb" stroke-width="2"/><path d="M1123 302h34" stroke="#c1ceb2" stroke-width="3"/>
<text x="1048" y="361" class="body">指定場所への運搬を確認</text><text x="1048" y="386" class="small">完了 / 未完了 / 判定不能</text>
<rect x="1048" y="410" width="74" height="21" rx="10" fill="#ecefe5"/><text x="1085" y="425" text-anchor="middle" class="small">NEXT STEP</text>
<!-- Real sample injected into scope -->
<path d="M390 467v-16" fill="none" stroke="#8ca673" stroke-width="2" marker-end="url(#arrow)"/>
<text x="296" y="488" class="label">今回の入力：動作・静止のRover録画</text>
<text x="973" y="488" text-anchor="end" class="small">復元映像から動きを計測</text>
<!-- Playful reminder -->
<g transform="translate(43 476) scale(.83)"><use href="#robot"/></g>
<path d="M134 552h111" stroke="#d0dac3" stroke-width="1.5"/><text x="146" y="541" font-size="12" fill="#7b8e6d">見た目だけ、</text><text x="146" y="571" font-size="17" font-weight="600">お休みです。</text>
<rect x="285" y="542" width="967" height="63" rx="10" fill="#f4f5ed"/>
<text x="308" y="568" class="body">Roverの作業映像をカバーに埋め込み、保存したStegoから復元して、動きを計測します。</text>
<text x="308" y="588" class="small">Revealは事前復元した映像の表示です。運搬完了の自動判定は今後の拡張です。</text>
</svg>'''.replace('STEGOPNG', stego).replace('SECRETPNG', recovered)
(OUTPUT / 'how-it-works.svg').write_text(svg, encoding='utf-8')
print('Created Japanese diagram')
translations = {
 '見た目はバカンス、中身はお仕事。ロボットの作業映像を隠して検証する仕組み':'Looks like a holiday. Hides a working robot. How the demo works.',
 '緑の範囲はRoverの録画、埋込み、復元、動きの計測。作業映像を実写カバーへLF-VSNで埋め込み、保存したStegoから復元したフレームの差分を計測する。運搬完了の自動判定は今後の拡張。':'The green area covers Rover recordings, embedding, reconstruction and motion measurement. LF-VSN hides footage in a cover and reconstructs frames from saved Stego. Frame differences measure motion. Automated delivery verification is a future extension.',
 'ロボットの仕事を、映像から確かめるプロジェクト':'Verifying robot work from video',
 'このデモのしくみ':'INSIDE THIS DEMO',
 '録画 → 埋込み → 復元 → 動きを計測':'Record → embed → reconstruct → measure',
 '仕事ぶりを撮る':'Record the work',
 '動くRover / 静止するRover':'Moving / stationary rover',
 '実機の録画2本を使用':'Two real rover recordings',
 '動画に動画を隠す':'Hide the footage',
 'カバー ＋ 秘密の作業映像':'Cover + hidden work footage',
 'StegaVARの埋め込み処理':'StegaVAR embedding pipeline',
 '見た目はバカンス':'Looks like a holiday',
 '中のロボットは勤務中。':'The robot inside is on duty.',
 '画素の小さな変化に埋め込む':'Hidden in tiny pixel changes',
 '保存したStego動画だけを':'Only the saved Stego video',
 '復元処理へ渡す':'is passed to reconstruction',
 '中身の動作を読む':'Read the action',
 'LF-VSNでロボット映像を復元':'LF-VSN recovers the footage',
 '復元フレームの差分を計測':'Measure recovered frame differences',
 '動作あり / ほぼ静止 / 判定保留':'Moving / still / inconclusive',
 '仕事、終わった？':'Job completed?',
 '指定場所への運搬を確認':'Verify delivery to its destination',
 '完了 / 未完了 / 判定不能':'Complete / incomplete / unsure',
 '今回の入力：動作・静止のRover録画':'Input: moving / stationary rover recordings',
 '復元映像から動きを計測':'Measure motion in recovered frames',
 '見た目だけ、':'Only the cover',
 'お休みです。':'is on holiday.',
 'Roverの作業映像をカバーに埋め込み、保存したStegoから復元して、動きを計測します。':'Hide Rover footage in a cover, reconstruct it from saved Stego, and measure motion in the recovered frames.',
 'Revealは事前復元した映像の表示です。運搬完了の自動判定は今後の拡張です。':'Reveal displays video reconstructed in advance. Automated delivery completion verification is a future extension.'
}
english = svg
for ja, en in translations.items():
    english = english.replace('>' + ja + '<', '>' + en + '<')
english = english.replace('.title{font-size:21px', '.title{font-size:19px').replace('.body{font-size:13px', '.body{font-size:12px')
(OUTPUT / 'how-it-works-en.svg').write_text(english, encoding='utf-8')
print('Created English diagram')
