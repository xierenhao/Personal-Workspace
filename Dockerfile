FROM node:18-slim

RUN apt-get update && apt-get install -y \
    texlive-xetex \
    texlive-fonts-recommended \
    texlive-fonts-extra \
    texlive-latex-extra \
    texlive-lang-chinese \
    fonts-wqy-zenhei \
    fonts-wqy-microhei \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package*.json ./
RUN npm install --production

COPY server/server.js ./
COPY Chinese_Resume_Template_中文简历模板___1_/ /app/Chinese_Resume_Template_中文简历模板___1_/

RUN mkdir -p temp resumes

EXPOSE 3000

CMD ["node", "server.js"]
