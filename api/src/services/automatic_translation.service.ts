import { Injectable } from '@nestjs/common';
import { config } from '../config';
import { TranslationServiceClient } from '@google-cloud/translate';

@Injectable()
export default class AutomaticTranslationService {
  location: String;
  projectId: String;

  constructor() {
    this.location = 'global';
    this.projectId = config.translators.google.projectId;
  }

  // @TODO: I dont know how to typecast this? Do I have to create a custom object type?
  async translate(requestTranslations: Array<any>, sourceLangCode: string, targetLangCode: string): Promise<any> {
    const translationClient = new TranslationServiceClient();

    return new Promise<Array<Object>>((resolve, reject) => {
      // @TODO: The api is limited to 1024 strings. For a draft I just have
      // it cut off at 1024, you can do multiple requests if you have more
      // strings.
      let arrayToTranslate: Array<string> = [];
      requestTranslations.slice(0, 1024).forEach(translation => {
        arrayToTranslate.push(translation.original);
      });

      const request = {
        parent: `projects/${this.projectId}/locations/${this.location}`,
        contents: arrayToTranslate,
        mimeType: 'text/html', // @TOOD: Or text/plain, It could include html tags..?
        sourceLanguageCode: sourceLangCode,
        targetLanguageCode: targetLangCode,
      };

      translationClient
        .translateText(request)
        .then((googleResponse: any) => {
          const translatedList: Array<object> = googleResponse[0].translations;

          if (translatedList.length != arrayToTranslate.length) {
            reject(Error('Response did not meet request amount.'));
          }

          translatedList.forEach((translation: any, index: number) => {
            requestTranslations[index].value = translation.translatedText;
          });

          resolve(requestTranslations);
        })
        .catch(error => {
          reject(error);
        });
    });
  }
}
