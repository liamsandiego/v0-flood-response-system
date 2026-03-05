"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertTriangle, MapPin, Phone, Users, Home, Package, ExternalLink, ShieldAlert } from "lucide-react"
import { DEPLOYMENT } from "@/lib/constants"

export function EvacuationTips() {
  const evacuationCenters = [
    {
      name: "Obando Municipal Covered Court",
      address: "Poblacion, Obando, Bulacan",
      distance: "0.8 km from dike station",
      phone: "(044) 815-1234",
    },
    {
      name: "Obando National High School",
      address: "J.P. Rizal St., Obando",
      distance: "1.2 km from dike station",
      phone: "(044) 815-2345",
    },
    {
      name: "Barangay Paliwas Multi-Purpose Hall",
      address: "Paliwas, Obando, Bulacan",
      distance: "1.5 km from dike station",
      phone: "(044) 815-3456",
    },
  ]

  const emergencyContacts = [
    { name: "Obando MDRRMO Hotline", number: "(044) 815-0911", available: "24/7" },
    { name: "Bulacan PDRRMO", number: "(044) 791-0300", available: "24/7" },
    { name: "PAGASA Weather Hotline", number: "(02) 8284-0800", available: "24/7" },
    { name: "Red Cross Bulacan", number: "143", available: "24/7" },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Risk Factors Banner */}
      <Card className="md:col-span-2 border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-yellow-600" />
            <CardTitle>Site-Specific Risk Factors — {DEPLOYMENT.shortName}</CardTitle>
          </div>
          <CardDescription>
            Identified flood threats for the Obando dike / flood gate monitoring station
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2 text-sm">
            {DEPLOYMENT.riskFactors.map((factor, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-yellow-600 font-bold">•</span>
                <span>{factor}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            <CardTitle>Flood Safety Guidelines</CardTitle>
          </div>
          <CardDescription>Essential information for flood preparedness and evacuation in Obando</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Package className="h-4 w-4" />
                Before the Flood
              </h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Prepare an emergency kit with food, water, medicine, and important documents</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Keep mobile phones fully charged and have power banks ready</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Store valuables and electronics in elevated areas above expected flood line</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Know the location of nearest evacuation centers listed below</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Monitor PAGASA bulletins for typhoon and tidal surge warnings</span>
                </li>
              </ul>
            </div>
            <div className="space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Home className="h-4 w-4" />
                During the Flood
              </h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Move to higher ground immediately — Obando elevation is only ~3 m ASL</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Avoid walking or driving through floodwater — strong currents near dike</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Turn off electricity and gas if instructed to evacuate</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Stay away from the dike and flood gate during high water events</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Follow official evacuation orders from MDRRMO Obando</span>
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-blue-500" />
            <CardTitle>Evacuation Centers</CardTitle>
          </div>
          <CardDescription>Designated safe locations in Obando, Bulacan</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {evacuationCenters.map((center, index) => (
              <div
                key={index}
                className="flex items-start justify-between gap-3 p-3 border rounded-lg hover:bg-accent transition-colors"
              >
                <div className="flex-1 space-y-1">
                  <p className="font-semibold text-sm">{center.name}</p>
                  <p className="text-xs text-muted-foreground">{center.address}</p>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-primary font-medium">{center.distance}</span>
                    <a href={`tel:${center.phone}`} className="flex items-center gap-1 hover:underline">
                      <Phone className="h-3 w-3" />
                      {center.phone}
                    </a>
                  </div>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <a
                    href={`https://www.google.com/maps/search/${encodeURIComponent(center.name + " " + center.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-green-500" />
            <CardTitle>Emergency Contacts</CardTitle>
          </div>
          <CardDescription>24/7 hotlines for immediate assistance</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {emergencyContacts.map((contact, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent transition-colors"
              >
                <div className="space-y-1">
                  <p className="font-semibold text-sm">{contact.name}</p>
                  <p className="text-xs text-muted-foreground">{contact.available}</p>
                </div>
                <Button size="sm" asChild className="touch-manipulation">
                  <a href={`tel:${contact.number.replace(/[^0-9]/g, "")}`}>
                    <Phone className="h-3 w-3 mr-2" />
                    {contact.number}
                  </a>
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-purple-500" />
            <CardTitle>Community Support</CardTitle>
          </div>
          <CardDescription>Additional resources and assistance for Obando residents</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button variant="outline" className="h-auto flex-col items-start gap-2 p-4 bg-transparent" asChild>
              <a href="https://www.facebook.com/ObandoBulacanDRRMO" target="_blank" rel="noopener noreferrer">
                <span className="font-semibold">Obando DRRMO Facebook Page</span>
                <span className="text-xs text-muted-foreground">Follow for official flood updates and advisories</span>
              </a>
            </Button>
            <Button variant="outline" className="h-auto flex-col items-start gap-2 p-4 bg-transparent" asChild>
              <a href="tel:0448150911">
                <span className="font-semibold">Report Emergency</span>
                <span className="text-xs text-muted-foreground">Call MDRRMO Obando: (044) 815-0911</span>
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
