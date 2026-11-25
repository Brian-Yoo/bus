# 버스 도착 알리미 (PWA)

서울 버스 정류소를 고르면 **노선별로 앞으로 1시간 안에 오는 버스**를 보여주는 웹앱입니다.
휴대폰 홈 화면에 아이콘으로 추가해서 앱처럼 쓸 수 있습니다. (지하철 도착 알리미와 같은 구조)

- 정류소 찾기 두 가지
  - **📍 지도**: 네이버 지도에 내 위치(파란 점)와 주변 정류소 핀 표시 → 핀이나 목록을 눌러 방향·노선 확인 → 선택
  - **이름/번호 검색**: 자동완성, 같은 이름이 길 양쪽에 있으면 "길 건너편 있음" 표시, 결과 옆 📍로 지도에서 위치 확인
- 도착 화면: 정류소 번호와 **→ 다음 정류장 방면** 표시, 노선마다 다음 버스 2대 중 1시간 이내만 (몇 번째 전, 혼잡도, 저상, 막차)
  - 위쪽 노선 버튼으로 한 노선만 보기, 1시간 안에 안 오는 노선은 아래에 접어서 표시
- 처음 화면에 자주 가는 정류소(+노선) 6개 (⚙ 설정에서 추가·순서변경·삭제, 도착 화면의 ☆로도 저장)
- ⚙ 설정: 아이콘 사진 변경(자르기 편집기), 홈 화면 설치 안내, 자주 가는 정류소 관리
- ? 사용 방법, 30초마다 자동 갱신, 휴대폰 뒤로가기, 다크 모드
- **인증키가 없으면 예시 데이터로 동작**합니다 (화면에 "예시 데이터" 표시). 지도 키가 없으면 지도 대신 가까운 정류소 목록만 나옵니다.

## 구조

```
public/          화면 (HTML/CSS/JS, manifest, service worker, 아이콘)
  style.css      공통 스타일 (지하철 앱과 같음)
  bus.css        버스 앱 전용 스타일 (노선 카드, 지도 시트)
api/             서버리스 함수 (Vercel) — 공공 API 키를 숨기고 HTTP→HTTPS 문제 해결
  search.js      GET /api/search?q=강남역   (5자리 번호도 가능)
  nearby.js      GET /api/nearby?lat=&lng=&radius=500  주변 정류소
  arrivals.js    GET /api/arrivals?stop=22009  정류소 도착정보 (15초 캐시)
  config.js      GET /api/config  네이버 지도 Client ID, 예시 데이터 여부
  upload-icon.js / icon-img.js / manifest.js   사진 아이콘 (지하철 앱과 같음)
lib/bus.js       버스 공공 API 호출과 정리 로직
lib/mock.js      인증키가 없을 때 쓰는 예시 데이터
lib/storage.js   아이콘 사진 저장 (배포: Vercel Blob, 로컬: .local-uploads/)
server.js        로컬 개발 서버
```

화면 주소: `https://주소/?stop=22009&route=140` 처럼 열면 그 정류소·노선으로 바로 시작합니다.

## 1. 버스 인증키 발급 (공공데이터포털)

지하철 키(data.seoul.go.kr)와는 **다른 사이트**입니다.

1. <https://www.data.go.kr> 회원가입 → 로그인
2. 검색창에 **서울특별시_정류소정보조회 서비스** 검색 → 오픈 API 탭에서 선택 → **활용신청**
   - 활용 목적 아무거나(예: 개인 앱 개발) 입력 → 신청. 개발계정은 보통 바로 승인됩니다.
3. **마이페이지 → 데이터활용 → Open API → 활용신청 현황**에서 이 서비스를 누르면 **일반 인증키**가 보입니다.
   - Encoding / Decoding 두 가지가 나오는데 **아무거나** 넣어도 됩니다 (앱이 알아서 처리).
4. 키가 실제로 동작하기까지 **1~2시간** 걸릴 수 있습니다. 그동안은 "인증키 오류"가 날 수 있어요.
5. 개발계정은 기능별 **하루 호출 횟수 제한**(보통 1,000회)이 있습니다. 앱은 화면이 켜져 있을 때만 30초마다 갱신하고, 서버에서 15초 동안 같은 정류소 결과를 재사용합니다.

## 2. 네이버 지도 키 발급 (네이버 클라우드 플랫폼)

1. <https://www.ncloud.com> 회원가입 → 로그인 (결제수단 등록이 필요할 수 있음. 지도는 월 무료 사용량 안에서는 요금이 나오지 않음)
2. **콘솔** → **Services → Application Services → Maps** 로 이동
3. **Application 등록** (또는 이용 신청)
   - 이름: 예) `bus`
   - API 선택: **Dynamic Map** 체크
   - **Web 서비스 URL**에 아래 주소를 모두 추가
     - `http://localhost:3000`, `http://localhost:3001` (내 PC에서 테스트용, 포트까지 구분함)
     - `https://bus-three-xi.vercel.app` (배포 주소)
4. 등록한 Application의 **인증 정보**에서 **Client ID**를 복사 → `NAVER_MAP_CLIENT_ID`에 넣기
   - Client Secret은 필요 없습니다.
5. 등록하지 않은 주소에서 열면 "네이버 지도 인증에 실패했어요" 안내가 뜨고 목록만 보입니다. 이때는 3번의 URL을 확인하세요.

## 3. 로컬에서 실행

Node.js **24 이상**이 필요합니다 (`node -v`로 확인).

```powershell
npm install               # 처음 한 번
copy .env.example .env    # 그리고 .env 안의 키를 내 키로 수정
npm run dev               # http://localhost:3000
```

`.env` 예시:

```
BUS_API_KEY=공공데이터포털 일반 인증키
NAVER_MAP_CLIENT_ID=네이버 클라우드 Maps Client ID
```

키를 바꾼 뒤에는 `npm run dev`를 껐다 켜야 합니다.
3000번 포트가 이미 쓰이고 있으면(예: 지하철 앱 실행 중) 3001번 등 다른 포트로 열립니다. 네이버 지도는 등록한 주소(포트 포함)에서만 되므로, 그 포트도 Web 서비스 URL에 등록해 두세요.

## 4. 배포 (Vercel, 무료) — 완료

- 배포 주소: **https://bus-three-xi.vercel.app**
- Vercel 팀 `trans` → 프로젝트 `bus` (https://vercel.com/trans13/bus). GitHub `main`에 push하면 자동 배포
- 환경변수: `BUS_API_KEY`, `NAVER_MAP_CLIENT_ID` (Settings → Environment Variables), `BLOB_STORE_ID`(Blob 연결 시 자동 생성)
- 사진 아이콘 저장소: Vercel Blob `bus-icons` (비공개, bus 프로젝트에 연결됨)
- 네이버 지도 Web 서비스 URL: `http://localhost:3000`, `http://localhost:3001`, `https://bus-three-xi.vercel.app`

처음부터 다시 만들 때의 순서 (참고용):
1. GitHub 저장소를 만들고 push
2. <https://vercel.com/new> → 저장소 옆 **Import**
   - 목록에 저장소가 없으면 **Configure GitHub App**(또는 Adjust GitHub App Permissions)에서 그 저장소 접근 허용
3. Application Preset을 **Other**로 변경 ("Possible configuration mismatch" 경고는 무시해도 됨)
4. **Environment Variables**에 두 키 입력 → **Deploy**
5. 배포 주소를 네이버 클라우드 Maps의 **Web 서비스 URL**에 추가
6. 프로젝트 → **Storage → Create Storage → Blob** (비공개, 접두어 `BLOB`) → 프로젝트 화면에서 만들면 자동 연결됨 → 다시 배포 (빈 커밋 push)

환경변수만 바꿨을 때는 다시 배포해야 반영됩니다. Redeploy 버튼을 찾기 어려우면 빈 커밋을 push하세요:

```powershell
git commit --allow-empty -m "재배포"
git push
```

## 5. 휴대폰 홈 화면에 추가

- **안드로이드(Chrome)**: ⚙ 설정 → 홈 화면에 아이콘 추가 (또는 메뉴 ⋮ → 홈 화면에 추가)
- **아이폰(Safari)**: 공유 버튼 → 홈 화면에 추가
- 위치(지도)는 **https 주소**에서만 동작합니다 (배포 주소 OK, `localhost` OK).

## 알려진 한계

- 버스 도착정보는 노선마다 **다음 2대**만 나옵니다. 그래서 "1시간 이내"는 그 2대 중 1시간 안쪽만 보여줍니다 (배차 간격이 짧은 노선은 1시간 안에 실제로 더 올 수 있음).
- 서울 버스 정보 기준입니다. 경기 버스 정류소 번호 체계는 다릅니다 (서울 정류소를 지나는 경기 버스는 표시됨).
- 남은 시간은 데이터가 만들어진 시각 기준으로 보정해서 보여주며, 교통 상황에 따라 달라집니다.
