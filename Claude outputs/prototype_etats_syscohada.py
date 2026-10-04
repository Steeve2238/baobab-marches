import pandas as pd
def sdv(d,*pfx,sign=None,excl=()):
    m=d.compte.apply(lambda c:c.startswith(pfx) and not c.startswith(tuple(excl)) if excl else c.startswith(pfx))
    s=d.loc[m,'sd']
    if sign=='D': s=s[s>0]
    if sign=='C': s=s[s<0]
    return float(s.sum())
def prep(d):
    d=d.copy(); d['sd']=d.sd_d-d.sd_c; d['an']=d.an_d-d.an_c; return d
def cr(d):
    S=lambda *p,**k: sdv(d,*p,**k)
    L={}
    L['TA']=-S('701');L['RA']=S('601');L['RB']=S('6031')
    L['TB']=-S('702','703','704');L['TC']=-S('705','706');L['TD']=-S('707')
    L['TE']=-S('73');L['TF']=-S('72');L['TG']=-S('71');L['TH']=-S('75');L['TI']=-S('781')
    L['RC']=S('602');L['RD']=S('6032');L['RE']=S('604','605','608');L['RF']=S('6033')
    L['RG']=S('61');L['RH']=S('62','63');L['RI']=S('64');L['RJ']=S('65');L['RK']=S('66')
    L['TJ']=-S('791','798','799');L['RL']=S('681','691')
    L['TK']=-S('77');L['TL']=-S('797');L['TM']=-S('787');L['RM']=S('67');L['RN']=S('687','697')
    L['TN']=-S('82');L['TO']=-S('84','86','88');L['RO']=S('81');L['RP']=S('83','85');L['RQ']=S('87');L['RS']=S('89')
    L['XB']=L['TA']+L['TB']+L['TC']+L['TD']-L['RA']+0  # XA first
    XA=L['TA']-L['RA']-L['RB']; L['XA']=XA
    L['XB']=XA+L['TB']+L['TC']+L['TD']
    L['XC']=L['XB']+(L['TE']+L['TF']+L['TG']+L['TH']+L['TI'])-(L['RC']+L['RD']+L['RE']+L['RF']+L['RG']+L['RH']+L['RI']+L['RJ'])
    L['XD']=L['XC']-L['RK']
    L['XE']=L['XD']+L['TJ']-L['RL']
    L['XF']=L['TK']+L['TL']+L['TM']-L['RM']-L['RN']
    L['XG']=L['XE']+L['XF']
    L['XH']=L['TN']+L['TO']-L['RO']-L['RP']
    L['XI']=L['XG']+L['XH']-L['RQ']-L['RS']
    return L
def bilan(d):
    S=lambda *p,**k: sdv(d,*p,**k)
    A={}  # code -> (brut, amort)
    def imm(code,pb,pa,pd=()):
        A[code]=(S(*pb), -S(*pa) -S(*pd) if (pa or pd) else 0.0)
    imm('AE',('211',),('2811',),('2911',))
    imm('AF',('212','213','214'),('2812','2813','2814'),('2912','2913','2914'))
    imm('AG',('215','216'),('2815','2816'),('2915','2916'))
    imm('AH',('217','218','219'),('2817','2818','2819'),('2917','2918','2919'))
    imm('AJ',('22',),('282',),('292',))
    A['AK']=(S('231','232','233','237','239',excl=('2392','2393','2394','2395','2399')),-S('2831','2832','2833','2837','293'))
    imm('AL',('234','235','238','2392','2393','2394','2395','2399'),('2834','2835','2838'),())
    imm('AM',('24',),('284',),('294',))
    A['AM']=(S('24',excl=('245',)),-S('284',excl=('2845',))-S('294',excl=('2945',)))
    A['AN']=(S('245'),-S('2845')-S('2945'))
    imm('AP',('25',),(),('295',))
    imm('AR',('26',),(),('296',))
    imm('AS',('27',),(),('297',))
    # circulant
    A['BA']=(S('485','486','488',sign='D'),0.0)
    A['BB']=(S('31','32','33','34','35','36','37','38'),-S('39'))
    A['BH']=(S('40',sign='D'),-S('490'))
    A['BI']=(S('41',excl=('419',),sign='D'),-S('491'))
    A['BJ']=(S('42','43','44','45','46','47','48',excl=('485','486','488','478'),sign='D'),-S('492','493','494','495','496','497','498'))
    A['BQ']=(S('50'),-S('590'))
    A['BR']=(S('51',sign='D'),-S('591'))
    A['BS']=(S('52','53','54','55','56','57','58',sign='D'),-S('592','593','594','595','596','597','598'))
    A['BU']=(S('478'),0.0)
    # passif : positive = credit
    P={}
    C=lambda *p,**k: -sdv(d,*p,**k)
    resultat = -sum(d.loc[d.compte.str[0].isin(list('678')),'sd'])
    P['CA']=C('101','102','103','104'); P['CB']=C('109'); P['CD']=C('105'); P['CE']=C('106')
    P['CF']=C('111','112','113'); P['CG']=C('118'); P['CH']=C('12')
    P['CI']=resultat + C('13')   # 13 non encore affecte
    P['CL']=C('14'); P['CM']=C('15')
    P['DA']=C('16'); P['DB']=C('17'); P['DC']=C('19')
    P['DH']=C('481','482','484','485','486','488',sign='C') if False else C('481','482','484','488',sign='C')
    P['DI']=C('419')+C('41',excl=('419',),sign='C')
    P['DJ']=C('40',excl=('409',),sign='C')+C('409',sign='C')
    P['DK']=C('42','43','44',sign='C')
    P['DM']=C('45','46','47',excl=('478','479'),sign='C')
    P['DN']=C('499')
    P['DQ']=C('564','565'); P['DR']=C('52','53','54','55','56','57','58',excl=('564','565'),sign='C')
    P['DV']=C('479')
    return A,P,resultat
def totaux(A,P):
    net=lambda c:A[c][0]-A[c][1] if c in A else 0
    T={}
    T['AZ']=sum(net(c) for c in ['AE','AF','AG','AH','AJ','AK','AL','AM','AN','AP','AR','AS'])
    T['BK']=sum(net(c) for c in ['BA','BB','BH','BI','BJ'])
    T['BT']=sum(net(c) for c in ['BQ','BR','BS'])
    T['BZ']=T['AZ']+T['BK']+T['BT']+net('BU')
    p=P
    T['CP']=sum(p[c] for c in ['CA','CD','CE','CF','CG','CH','CI','CL','CM'])-p['CB']
    T['DD']=T['CP']+p['DA']+p['DB']+p['DC']
    T['DP']=sum(p[c] for c in ['DH','DI','DJ','DK','DM','DN'])
    T['DT']=p['DQ']+p['DR']
    T['DZ']=T['DD']+T['DP']+T['DT']+p['DV']
    return T
