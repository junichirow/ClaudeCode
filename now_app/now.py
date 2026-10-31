from datetime import datetime
from zoneinfo import ZoneInfo

now = datetime.now(ZoneInfo("Asia/Tokyo"))
print(now.strftime("%Y年%m月%d日 %H時%M分%S秒"))