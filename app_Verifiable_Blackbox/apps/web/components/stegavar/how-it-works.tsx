"use client";
import Image from "next/image";
import {useLanguage} from "@/components/language";
import type {Scene} from "@/lib/stegavar/types";
import {publicPreview} from "@/lib/public-preview";

export function HowItWorks({scenes=[]}:{scenes?:Scene[]}) {
  const {language,t}=useLanguage();
  const diagram=`/stegavar/illustrations/how-it-works${language==="en"?"-en":""}.svg`;
  return <>
    <section className="stg-how" aria-labelledby="stg-how-title">
      <div className="stg-how-heading"><div><p className="eyebrow">THE TRICK BEHIND THE TRIP</p>
        <h2 id="stg-how-title">{t("A holiday on the outside. Work on the inside.","休暇の映像に、仕事の記録。")}</h2></div>
        <a href={diagram} target="_blank" rel="noreferrer">{t("Open full-size diagram ↗","図を大きく見る ↗")}</a>
      </div>
      <p className="stg-muted">{t("Rover footage is hidden in a holiday cover, reconstructed from the saved video, then measured for visible motion.","Roverの作業映像をバカンスのカバーに埋め込み、保存した動画から復元して、動きを計測します。")}</p>
      <p className="stg-scroll-hint">{t("Swipe to explore the diagram →","図は横にスワイプできます →")}</p>
      <div className="stg-diagram-scroll" tabIndex={0} role="region" aria-label={t("How StegaVAR works — scrollable diagram","StegaVARのしくみ・横スクロールできる図")}>
        <Image src={diagram} width={1280} height={640} unoptimized alt={t("Rover recordings are embedded into a cover with LF-VSN. Saved Stego is reconstructed into Rover frames, whose differences measure motion. Automatic delivery completion verification is a future extension.","Rover録画をLF-VSNでカバー映像へ埋め込み、保存したStegoから復元。復元フレームの差分で動きを計測します。運搬完了の自動判定は今後の拡張です。")}/>
      </div>
      <div className="stg-proof-points">
        <div><span>01 / HIDE</span><h3>{t("Footage within footage.","風景の中に、別の動画。")}</h3><p>{t("Small changes in the cover's pixels carry the Rover footage.","画素の小さな変化にRoverの作業映像を埋め込みます。")}</p></div>
        <div><span>02 / REVEAL</span><h3>{t("Bring the Rover into view.","保存した動画から取り出す。")}</h3><p>{t("Reveal shows the reconstructed frames, ready for synchronized playback.","Revealで事前に復元したフレームを表示し、同期再生できます。")}</p></div>
        <div><span>03 / MEASURE</span><h3>{t("See how much it moved.","Roverの動きを確かめる。")}</h3><p>{t("Frame differences measure visible motion. Automatic delivery verification is a future extension.","フレーム差分から動きを計測します。運搬完了の自動判定は今後の拡張です。")}</p></div>
      </div>
    </section>
    <footer className="stg-credits"><span>StegaVAR / OFF DUTY LAB</span>
      <details><summary>{t("Footage, code and model credits","映像・コード・モデルの出典")}</summary>
        <ul>{scenes.map(scene=><li key={scene.id}><a href={scene.source} target="_blank" rel="noreferrer">{t(scene.titleEn,scene.titleJa)} — {scene.creator} · Pexels</a></li>)}</ul>
        <p><a href="https://www.pexels.com/license/" target="_blank" rel="noreferrer">Pexels License</a></p>
        <a href={publicPreview ? "/stegavar/SOURCES.md" : "/api/stegavar/assets/SOURCES.md"}>{t("All sources and licenses","出典・ライセンス一覧")}</a>
      </details>
    </footer>
  </>;
}
