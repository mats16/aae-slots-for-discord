import { ScheduledHandler } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import got from 'got';
const { Webhook, MessageBuilder } = require('discord-webhook-node');

const DISCORD_WEBHOOK_URL: string = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/0000/xxxx';
const LOFTAPP_SECRET_ARN: string = process.env.LOFTAPP_SECRET_ARN || '';

const ICON_URL: string = 'https://awsloft.tokyo/favicon.png'
const DESCRIPTION_MESSAGE: string = 'AWS Loft Tokyo では、オンラインで AWS に関する技術相談を無償にて承っております。AWS のテクノロジーに熟達した AWS のソリューションアーキテクトやサポートエンジニアへ技術的な相談が可能です！'
const FOOTER_MESSAGE: string = '※ 予約枠は投稿時点のものです。実際の予約枠は Loft App で確認をお願いします。'
const NO_SLOT_MESSAGE: string = '空いている予約枠がありません'
const WEEKDAY = [ "日", "月", "火", "水", "木", "金", "土" ]

const LOFTAPP_URL: string = 'https://awsloft.tokyo';
const SLOTS_API_URL:string = 'https://d34rct6gehngzd.cloudfront.net/api/v1/office-hour/slots'

const getSecretValueCommand = new GetSecretValueCommand({SecretId: LOFTAPP_SECRET_ARN})
const client = new SecretsManagerClient({})

const chromium = require('chrome-aws-lambda');
const hook = new Webhook(DISCORD_WEBHOOK_URL)
  .setUsername('Ask An Expert')
  .setAvatar(ICON_URL);

async function getIdToken(url: string, username: string, password: string) {
  const browser = await chromium.puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
  });

  try {
    const page = await browser.newPage();
    page.setViewport({width: 375, height: 812}); // iPhone
    // signin
    await page.goto(url, {waitUntil: "domcontentloaded"});
    await page.type('input[name="username"]', username, { delay: 100 });
    await page.type('input[name="password"]', password, { delay: 100 });
    await page.click('[type="button"]');
    await page.waitForSelector('[data-testid="qrCode"]', { timeout: 5000 });

    const idToken = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key: string = localStorage.key(i) || '';
        if (key.endsWith('.idToken')) {
          return localStorage.getItem(key);
        }
      }
      return 'null'
    });
    return idToken
  } catch(e) {
      throw e;
  } finally {
      await browser.close();
  }
}

async function getSlots(idToken: string) {
  const headers = {
    'Content-Type': "application/json;charset=utf-8",
    Authorization: idToken
  }
  const req = await got.get(SLOTS_API_URL, {headers: headers});
  const body = JSON.parse(req.body)
  return body.slots
}

function genMessage(slots: slot[]) {
  const msg = new MessageBuilder()
    .setTitle('Online Ask An Expert 予約可能枠')
    .setURL(`${LOFTAPP_URL}/reserve`);
  const nowDate = new Date();
  const slotsJson: any = {}
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const startDate = new Date(slot.time * 1000);
    const startTime = startDate.toLocaleTimeString('ja-JP',{hour:'numeric',minute:'numeric'});
    const endDate = new Date((slot.time + 45*60) * 1000);
    const endTime = endDate.toLocaleTimeString('ja-JP',{hour:'numeric',minute:'numeric'});
    const day = startDate.toLocaleDateString('ja-JP', {era:'long'}).slice(7);
    const weekDay = WEEKDAY[startDate.getDay()];
    const date = `${day}(${weekDay})`
    const event = `${startTime} - ${endTime}\t${slot.eventName}`
    if (!(date in slotsJson)) {
      slotsJson[date] = new Array();
    }
    if (startDate >= nowDate && slot.remain == 1) {
      slotsJson[date].push(event);
    }
  }
  //for (let i = 0; i <  Object.keys(slotsJson).length; i++) {
  for (let i = 0; i <  2; i++) {
    // 一旦、当日と翌日だけ
    const k = Object.keys(slotsJson)[i];
    const v: string[] = slotsJson[k];
    const fieldValue: string = (v.length == 0)
      ? NO_SLOT_MESSAGE
      : slotsJson[k].join('\n')
    msg.addField(k, fieldValue)
  }
  msg.setDescription(DESCRIPTION_MESSAGE);
  msg.setThumbnail('https://awsloft.tokyo/static/media/Hajime.0876d4b8.png');
  //msg.setImage('https://awsloft.tokyo/static/media/AAE.2c1f7050.jpg');
  msg.setFooter(FOOTER_MESSAGE);
  return msg;
}

interface slot {
  time: number
  remain: number
  type?: string
  typeVariant?: number
  eventName: string
  description?: string
}

export const handler: ScheduledHandler<any> = async (event, context) => {
  const {SecretString} = await client.send(getSecretValueCommand);
  const secret = JSON.parse(SecretString || '{}')

  const idToken: string = await getIdToken(`${LOFTAPP_URL}/signin`, secret.username, secret.password);
  const slots: slot[] = await getSlots(idToken);
  const msg = genMessage(slots)
  await hook.send(msg);
};
