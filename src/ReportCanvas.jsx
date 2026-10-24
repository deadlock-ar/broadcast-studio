import { useEffect, useRef } from "react";
import {
  drawHeroReport,
  drawItemReport,
  drawMvpReport,
} from "./report-canvas.js";
export default function ReportCanvas({ report }) {
  const canvas = useRef(null);
  useEffect(() => {
    document.documentElement.classList.add("production-broadcast-document");
    return () =>
      document.documentElement.classList.remove(
        "production-broadcast-document",
      );
  }, []);
  useEffect(() => {
    if (!report?.visible || !canvas.current) return;
    let active = true;
    const temp = document.createElement("canvas"),
      draw = {
        heroes: drawHeroReport,
        items: drawItemReport,
        mvp: drawMvpReport,
      }[report.mode];
    draw(temp, report)
      .then(() => {
        if (active && canvas.current) {
          canvas.current.width = temp.width;
          canvas.current.height = temp.height;
          canvas.current.getContext("2d").drawImage(temp, 0, 0);
        }
      })
      .catch(() => {
        if (canvas.current)
          canvas.current
            .getContext("2d")
            .clearRect(0, 0, canvas.current.width, canvas.current.height);
      });
    return () => {
      active = false;
    };
  }, [report]);
  return report?.visible ? (
    <div className="report-output-stage">
      <canvas
        className="report-output-canvas"
        ref={canvas}
        aria-label="Tournament report"
      />
    </div>
  ) : null;
}
