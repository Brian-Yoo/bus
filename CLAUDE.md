# 버스 도착 알리미 (PWA)

서울 버스 정류소(검색 또는 네이버 지도에서 주변 정류소 선택) → 노선별 1시간 이내 도착 버스를 보여주는 휴대폰 웹앱. 지하철 앱(D:\Trans, github.com/Brian-Yoo/trans)과 같은 구조. 사용자는 한국어로 소통.

- 구조와 실행법은 README.md, 다른 PC 설정은 집에서_작업하기.md, 작업 정리는 docs/프로젝트_정리.md
- GitHub 저장소·Vercel 프로젝트는 아직 없음 (만들면 여기에 주소 기록)

## 규칙
- 커밋 작성자 이메일은 `357139478+Brian-Yoo@users.noreply.github.com` (개인 이메일이면 GitHub가 push 거부, GH007)
- `.env`(인증키)는 절대 커밋하지 않음. `.env.example`에는 `sample` 같은 자리표시 값만
- 화면을 바꾸면 `public/sw.js`의 `CACHE` 버전(bus-vN)을 올려야 휴대폰에 새 버전이 반영됨
- 휴대폰 화면(375px 폭) 기준으로 확인. 사용자는 주로 휴대폰에서 사용

## 알아둘 점
- 버스 API: 공공데이터포털 "서울특별시_정류소정보조회 서비스"(ws.bus.go.kr/api/rest/stationinfo, http). 키 `BUS_API_KEY` (Encoding/Decoding 둘 다 처리). 키가 없거나 `sample`이면 lib/mock.js 예시 데이터
  - getStationByName(이름 검색), getStationByPos(주변, tmX=경도 tmY=위도), getStationByUid(arsId 도착정보)
- 네이버 지도: NCP Maps Dynamic Map, `maps.js?ncpKeyId=` (Client ID만, `NAVER_MAP_CLIENT_ID`). Web 서비스 URL 등록한 주소에서만 동작, 실패 시 `navermap_authFailure` → 목록만 표시. 등록된 로컬 주소: localhost:3000, localhost:3001 (포트 구분)
- 네이버 지도가 #map에 position:relative를 넣으므로 크기는 width/height 100%로 (inset 쓰면 높이 0)
- `/api/config`는 브라우저 캐시 금지 (키를 바꿨을 때 바로 반영되게)
- 사진 아이콘: Vercel Blob 비공개 저장소, 지하철 앱과 같은 코드
- 회사 PC는 HTTP 프록시 환경이라 `npm run dev`가 `node --use-env-proxy` 사용 (Node 24+ 필요)
