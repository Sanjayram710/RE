const fs = require('fs');
const path = require('path');

const rootDir = 'C:/RE';
const stylePath = path.join(rootDir, 'style.css');
const publicStylePath = path.join(rootDir, 'public/style.css');

const stitchCss = `

/* ========================================================================= */
/* STITCH FINTECH DESIGN SYSTEM UTILITIES & RESPONSIVE EXPANSIONS            */
/* ========================================================================= */
@keyframes pulse-subtle {
  0%, 100% { outline-color: rgba(0, 104, 95, 0.9); box-shadow: 0 0 0 2px rgba(0, 104, 95, 0.2); }
  50% { outline-color: rgba(0, 104, 95, 0.4); box-shadow: 0 0 0 4px rgba(0, 104, 95, 0.35); }
}

.ocr-box {
  position: relative;
  outline: 1.5px dashed #008378;
  background-color: rgba(0, 131, 120, 0.08);
  border-radius: 4px;
  transition: all 0.15s ease-in-out;
}

.ocr-box:hover {
  background-color: rgba(0, 131, 120, 0.18);
  outline: 2px solid #00685f;
}

.ocr-box-warning {
  outline: 1.5px dashed #d97706;
  background-color: rgba(217, 119, 6, 0.1);
}

.ocr-tag {
  position: absolute;
  top: -14px;
  left: 0;
  font-size: 9px;
  line-height: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 4px;
  border-radius: 2px;
  color: #ffffff;
  background-color: #00685f;
  pointer-events: none;
  z-index: 10;
}

.material-symbols-outlined {
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
  display: inline-block;
  vertical-align: middle;
  line-height: 1;
}

/* Custom Stitch Scrollbars */
.custom-scrollbar::-webkit-scrollbar,
.custom-scroll::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}
.custom-scrollbar::-webkit-scrollbar-track,
.custom-scroll::-webkit-scrollbar-track {
  background: #f8f9ff;
}
.custom-scrollbar::-webkit-scrollbar-thumb,
.custom-scroll::-webkit-scrollbar-thumb {
  background: #bcc9c6;
  border-radius: 4px;
}

/* Responsive sidebar overlay */
@media (max-width: 1023px) {
  .stitch-sidebar {
    position: fixed !important;
    top: 0 !important;
    bottom: 0 !important;
    left: 0 !important;
    width: 280px !important;
    z-index: 9999 !important;
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.25) !important;
  }
}
`;

let styleContent = fs.readFileSync(stylePath, 'utf8');
if (!styleContent.includes('STITCH FINTECH DESIGN SYSTEM UTILITIES')) {
  styleContent += stitchCss;
  fs.writeFileSync(stylePath, styleContent, 'utf8');
  fs.writeFileSync(publicStylePath, styleContent, 'utf8');
  console.log('Appended Stitch CSS to style.css and public/style.css');
} else {
  console.log('Stitch CSS already present in style.css');
}
