'use client';

import Link from 'next/link';
import { useDB } from '@/lib/store';
import { PILOT_NAME } from '@/lib/geo';
import { WANT_DAYS } from '@/lib/rules';
import { GOOGLE_LOGIN } from '@/lib/backend';
import { Contact, LegalDoc, Operator, type Clause } from '@/components/Legal';

/** 使用條款 (draft). The numbers come from the live settings, so they match what the site does. */
export default function TermsPage() {
  const s = useDB()!.settings;
  const fee = Math.round(s.feeRate * 100);

  const clauses: Clause[] = [
    {
      title: '帳號',
      body: (
        <ul>
          <li>
            {GOOGLE_LOGIN
              ? '用 Google 帳戶登入，或用 Email 收一次性驗證碼登入，不用在 Myrs 設密碼。一個信箱只能有一個帳號（用 Google 登入和用同一個 Gmail 收驗證碼，是同一個帳號），請用你自己的帳戶和信箱，並保管好它；'
              : '用 Email 收一次性驗證碼登入，不用設密碼。一個信箱只能有一個帳號，請用你自己的信箱，並保管好它；'}
            用你的帳號做的事，由你負責。
          </li>
          <li>不可以冒用別人的身分，也不可以為了拿獎勵點數建立多個帳號。</li>
          <li>暱稱和自介會公開給其他使用者看，不可以有冒犯、歧視、廣告或別人的個人資料。</li>
          <li>未滿 18 歲的人，要先讓法定代理人（例如父母）看過並同意這份條款才能使用，面交時也要有大人陪同。</li>
          <li>你隨時可以在「我的」頁面刪除帳號，刪除後會發生什麼，請看《隱私權政策》。</li>
        </ul>
      ),
    },
    {
      title: 'Myrs 的角色',
      body: (
        <>
          <p>
            Myrs 提供刊登、搜尋、聊天和點數紀錄的工具，讓鄰居彼此分享物品。<b>我們不是交易的任何一方</b>：我們不買賣、不保管、不檢查物品，也不參加面交。
          </p>
          <ul>
            <li>物品是否安全、是否和描述一樣，由提供的人負責。</li>
            <li>收到的人要自己判斷能不能用、能不能吃；食品請先看包裝和到期日。</li>
            <li>我們會用審核、檢舉和爭議處理維持秩序，但沒辦法保證每則刊登都正確、每個人都可信。</li>
          </ul>
        </>
      ),
    },
    {
      title: '可以刊登什麼',
      body: (
        <>
          <p>試點期間只開放食品和衣物。</p>
          <ul>
            <li>
              <b>食品</b>：只接受未拆封的包裝食品、即期品和生鮮蔬果，要如實填寫到期日和保存方式，過期會自動下架。不接受自製熟食、酒類、保健食品、嬰兒配方奶粉。
            </li>
            <li>
              <b>衣物</b>：要洗乾淨、可以正常穿。不接受貼身衣物（內衣褲）。
            </li>
            <li>
              <b>任何情況都不能刊登</b>：菸品（含電子煙）、酒類、藥品、武器和刀械、活的動物（含寵物）、仿冒品，以及違法或來路不明的東西。
            </li>
            <li>照片和描述要是你要給的那件物品本身。不可以刊登廣告、把人帶到別的平台，或要求用現金交易。</li>
            <li>含有特定字詞的刊登會先由管理員審核；違反規定的刊登，我們可以直接下架。</li>
            <li>
              「徵求」貼文是請鄰居刊登你需要的東西，一樣要遵守上面的規定，{WANT_DAYS} 天後自動結束。
            </li>
            <li>刊登的文字和照片還是你的，但你同意我們在 Myrs 上顯示、縮小、整理這些內容，讓附近的人看到。</li>
          </ul>
        </>
      ),
    },
    {
      title: '點數',
      body: (
        <ul>
          <li>
            點數只是 Myrs 裡的紀錄，用來索取別人刊登的物品。<b>點數不能換成現金，也不能轉帳或送給別人。</b>目前不販售點數。
          </li>
          <li>
            怎麼拿到：註冊送 {s.signupBonus} 點、第一次刊登送 {s.firstListingReward} 點、第一次完成交易送 {s.firstOrderReward} 點
            {s.inviteReward > 0 && `、邀請鄰居成功雙方各得 ${s.inviteReward} 點`}。獎勵點數每月最多 {s.monthlyRewardCap} 點，{s.rewardExpiryMonths}{' '}
            個月後到期。
          </li>
          <li>
            用點數索取時，點數會先凍結；交易完成才轉給提供的人，提供的人付 {fee}% 手續費（最少 {s.minFee} 點）；交易取消會退回。
          </li>
          <li>
            新帳號前 {s.newAccountDays} 天，點數交易合計最多 {s.newAccountPointsCap} 點。
          </li>
          <li>用不正當的方法拿點數（例如開多個帳號、假交易、互相刷點），我們會收回點數，並可能停權。</li>
          <li>刪除帳號、帳號被永久停權或 Myrs 結束服務時，剩下的點數會失效，不會換成現金或其他補償。</li>
          <li>點數規則可能調整，調整前會在網站公告。</li>
        </ul>
      ),
    },
    {
      title: '交易和面交',
      body: (
        <>
          <ol>
            <li>你送出索取後，提供的人有 {s.requestTimeoutHours} 小時可以回覆，沒回覆會自動取消並退點。</li>
            <li>提供的人接受後，雙方才會看到聊天室和精確的面交地點，請在聊天室約好時間。</li>
            <li>
              面交後雙方都按「面交完成」才算成交；一方按了以後，另一方 {s.autoCompleteHours} 小時內沒回應就自動完成
              {s.acceptTimeoutDays > 0 && `；接受後 ${s.acceptTimeoutDays} 天都沒有人按，就自動取消並退點`}。
            </li>
          </ol>
          <ul>
            <li>免費索取每人每天最多 {s.freeDailyLimit} 件。</li>
            <li>以物易物的物品價值由雙方自己談，Myrs 不保證兩邊等值。</li>
            <li>不可以在 Myrs 以外要求對方付錢或轉帳。</li>
            <li>為了安全，請約在白天、人多的公共場所，可以找家人朋友陪同；不需要的個人資料不要給對方。</li>
          </ul>
        </>
      ),
    },
    {
      title: '爭議處理',
      body: (
        <ul>
          <li>交易有問題時，可以在交易頁按「提出爭議」，由管理員看聊天紀錄、照片和雙方說明後，決定點數怎麼處理。</li>
          <li>處理爭議時，管理員會看這筆交易的聊天內容。</li>
          <li>管理員的決定只處理 Myrs 裡的點數，不影響你依法律向對方主張的權利。</li>
          <li>遇到人身安全或犯罪問題，請直接打 110 報警。</li>
        </ul>
      ),
    },
    {
      title: '評價、檢舉和封鎖',
      body: (
        <ul>
          <li>交易完成後 {s.reviewWindowDays} 天內可以互相評價。評價要真實，不可以人身攻擊。</li>
          <li>看到違規的刊登或使用者，請按「檢舉」。同一則刊登被 {s.reportHideThreshold} 個人檢舉，會先隱藏，等管理員處理。</li>
          <li>不想再看到某個人，可以封鎖對方。</li>
        </ul>
      ),
    },
    {
      title: '不可以做的事',
      body: (
        <ul>
          <li>違法、詐騙、騷擾、恐嚇、歧視或散布色情的內容和行為。</li>
          <li>收集、公開別人的個人資料，或把聊天內容拿去做交易以外的用途。</li>
          <li>發廣告、拉人到別的平台、轉賣別人送的東西牟利。</li>
          <li>用程式大量抓取資料、攻擊或干擾系統，或想辦法躲過停權和各種限制。</li>
        </ul>
      ),
    },
    {
      title: '違規的處理',
      body: (
        <>
          <p>依情況，我們可以提醒你、下架刊登、取消交易並退點、收回不當取得的點數，或暫時、永久停權，並會告訴你原因。</p>
          <p>
            如果你覺得處理有誤，可以寫信到 <Contact /> 申訴。
          </p>
        </>
      ),
    },
    {
      title: '服務的變更和責任',
      body: (
        <ul>
          <li>Myrs 目前在{PILOT_NAME}試點，功能可能調整、暫停或結束；會盡量提早在網站公告。</li>
          <li>系統維護、網路問題，或我們使用的服務（資料庫、網站主機、地圖、寄信服務）出問題，可能讓 Myrs 暫時不能用。</li>
          <li>使用者之間交換的物品和面交過程造成的損害，由當事人自己處理；但因為我們的故意或重大過失造成的損害，我們依法負責。</li>
        </ul>
      ),
    },
    {
      title: '條款的修改',
      body: <p>修改這份條款時，會在網站公告；重大修改會另外發站內通知。修改生效後你繼續使用 Myrs，就表示同意修改後的條款。</p>,
    },
    {
      title: '適用法律和管轄法院',
      body: <p>這份條款依中華民國法律解釋。發生訴訟時，以臺灣臺北地方法院為第一審管轄法院，但法律另有規定的（例如消費者保護法），依照法律規定。</p>,
    },
    {
      title: '聯絡我們',
      body: (
        <p>
          有任何問題，請寫信到 <Contact />。
        </p>
      ),
    },
  ];

  return (
    <LegalDoc
      kind="terms"
      title="使用條款（草稿）"
      intro={
        <p>
          Myrs 你的我的共享平台（以下簡稱「Myrs」）由 <Operator />（以下簡稱「我們」）營運，讓鄰居把用不到的即期食品和二手衣物分享給需要的人。註冊或使用
          Myrs，就表示你已經看過並同意這份使用條款和
          <Link href="/privacy" className="text-brand underline underline-offset-2">
            隱私權政策
          </Link>
          。如果不同意，請不要使用。
        </p>
      }
      clauses={clauses}
    />
  );
}
